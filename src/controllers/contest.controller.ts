// src/controllers/contest.controller.ts
import { Request, Response } from 'express';
import ContestRecord from '../models/contest-record.model';
import * as ratingService from '../services/rating.service';
import { success, fail } from '../utils/response';
import User from '../models/user.model';

// 1. 录入比赛/奖项
export const addContestRecord = async (req: Request, res: Response) => {
  try {
    const { 
      userId, 
      type,       // 比赛类型 (e.g. 'XCPC_REGIONAL', 'LANQIAO')
      name,       // 比赛名称 (e.g. '第48届ICPC济南站')
      season,     // 赛季 (e.g. '2023-2024')
      awardLevel, // 奖项等级 (e.g. 'NAT_1'), 常规比赛传 null 或不传
      rank,       // 排名 (常规比赛必填)
      totalParticipants // 总人数 (常规比赛必填)
    } = req.body;

    if (!userId || !type || !name || !season) {
      return fail(res, '缺少必要参数');
    }

    // A. 计算原始得分 (存库前先算好，方便查看)
    const rawScore = ratingService.calculateRawScore(
      type, 
      awardLevel || null, 
      season, 
      totalParticipants || 0,
      rank || 0
    );

    // B. 创建记录
    const newRecord = await ContestRecord.create({
      userId,
      type,
      name,
      season,
      awardLevel: awardLevel || null,
      rank: rank || 0,
      totalParticipants: totalParticipants || 0,
      rawScore
    });

    // C. [关键步骤] 触发该用户的总分重算
    const newTotalRating = await ratingService.updateUserTotalRating(userId);

    success(res, { record: newRecord, newTotalRating }, '录入成功, Rating 已更新');
  } catch (error: any) {
    fail(res, error.message || '录入失败', 500);
  }
};

// 2. 获取某用户的比赛记录列表
export const getUserContestRecords = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    // 按时间倒序
    const list = await ContestRecord.find({ userId }).sort({ contestDate: -1 });
    success(res, list);
  } catch (error: any) {
    fail(res, '获取记录失败', 500);
  }
};

// 3. 删除比赛记录 (比如录错了)
export const deleteContestRecord = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // 找到记录以便获取 userId
    const record = await ContestRecord.findById(id);
    if (!record) return fail(res, '记录不存在', 404);

    const userId = record.userId.toString();

    // 删除
    await ContestRecord.findByIdAndDelete(id);

    // [关键步骤] 删除后也要触发重算！
    await ratingService.updateUserTotalRating(userId);

    success(res, null, '删除成功, Rating 已重新计算');
  } catch (error: any) {
    fail(res, '删除失败', 500);
  }
};

// 4. 批量导入比赛排名
export const importContestRankings = async (req: Request, res: Response) => {
  try {
    const { season, name, type, totalParticipants, rawData } = req.body;
    // rawData 结构: [{ rank: 1, members: [{ name: '张三', studentId: '...' }, ...] }, ...]

    if (!rawData || !Array.isArray(rawData)) {
      return fail(res, '数据格式错误');
    }

    // 1. 获取所有在役用户，建立内存映射以提高查找速度
    // Map<StudentId, User> 和 Map<RealName, User[]>
    const users = await User.find({ role: { $ne: 'Teacher' } });
    
    const idMap = new Map();
    const nameMap = new Map();

    users.forEach(u => {
      if (u.studentId) idMap.set(u.studentId, u);
      
      if (!nameMap.has(u.realName)) {
        nameMap.set(u.realName, []);
      }
      nameMap.get(u.realName).push(u);
    });

    const results = {
      successCount: 0,
      skipCount: 0,
      logs: [] as string[]
    };

    const recordsToInsert = [];
    const userIdsToUpdate = new Set<string>();

    // 2. 遍历前端传来的每一行（每一个队伍/排名）
    for (const team of rawData) {
      const currentRank = team.rank;
      
      // 遍历队伍里的每一个人
      for (const member of team.members) {
        let targetUser = null;

        // A. 优先尝试用学号匹配
        if (member.studentId && idMap.has(member.studentId)) {
          targetUser = idMap.get(member.studentId);
        } 
        // B. 如果没学号或没匹配到，尝试用姓名匹配
        else if (member.name && nameMap.has(member.name)) {
          const candidates = nameMap.get(member.name);
          if (candidates.length === 1) {
            targetUser = candidates[0];
          } else {
            results.logs.push(`[跳过] 姓名 "${member.name}" 存在重名且未提供学号，无法确定身份 (Rank ${currentRank})`);
            results.skipCount++;
            continue;
          }
        } else {
          // C. 找不到人
          // results.logs.push(`[跳过] 未找到用户 "${member.name}" (Rank ${currentRank})`);
          results.skipCount++;
          continue;
        }

        // --- 找到用户了，准备数据 ---
        
        // 计算分数 (复用 service)
        const rawScore = ratingService.calculateRawScore(
          type,
          null, // 导入通常没有奖项等级字段，主要靠排名
          season,
          totalParticipants,
          currentRank
        );

        recordsToInsert.push({
          userId: targetUser._id,
          type,
          name,
          season,
          rank: currentRank,
          totalParticipants,
          rawScore,
          contestDate: new Date()
        });

        userIdsToUpdate.add(targetUser._id.toString());
        results.successCount++;
      }
    }

    // 3. 批量写入数据库
    if (recordsToInsert.length > 0) {
      await ContestRecord.insertMany(recordsToInsert);
      
      // 4. 批量触发 Rating 更新 (异步执行即可，不需要等)
      // 注意：如果人数很多，这里可能要很久，建议用 Promise.all 或者队列
      // 这里简单处理：
      for (const uid of userIdsToUpdate) {
        await ratingService.updateUserTotalRating(uid);
      }
    }

    success(res, results, `导入完成: 成功录入 ${results.successCount} 人次`);

  } catch (e: any) {
    console.error(e);
    fail(res, e.message || '导入失败', 500);
  }
};