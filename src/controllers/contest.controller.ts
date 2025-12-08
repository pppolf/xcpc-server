// src/controllers/contest.controller.ts
import { Request, Response } from 'express';
import ContestRecord from '../models/contest-record.model';
import * as ratingService from '../services/rating.service';
import { success, fail } from '../utils/response';

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