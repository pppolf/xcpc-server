import { Request, Response } from 'express';
import { getMonthSnapshot } from '../services/rating.service';
import { success, fail } from '../utils/response';
import User from '../models/user.model';
import SeasonRating from '../models/season-rating.model';
import { getCurrentSeason } from '../services/config.service';

export const getSnapshotData = async (req: Request, res: Response) => {
  try {
    // 从 query 获取参数: /api/snapshots?year=2023&month=10
    const { year, month } = req.query;

    if (!year || !month) {
      return fail(res, '请提供年份和月份');
    }

    const data = await getMonthSnapshot(Number(year), Number(month));
    
    success(res, data);
  } catch (error: any) {
    fail(res, error.message || '获取快照失败', 500);
  }
};

export const getLeaderboard = async (req: Request, res: Response) => {
  try {
    // 1. 获取请求的赛季，如果没有传，默认当前赛季
    const currentSeason = getCurrentSeason();
    const targetSeason = (req.query.season as string) || currentSeason;
    
    let list = [];

    if (targetSeason === currentSeason) {
      // === A. 查询当前赛季 (读 User 表实时数据) ===
      const users = await User.find({ 
        role: { $ne: 'Teacher' }, 
      })
      .select('realName studentId college role rating status ratingInfo')
      .sort({ rating: -1, 'ratingInfo.contest': -1 }) // 总分降序，同分看比赛分
      .lean();

      // 数据归一化
      list = users.map(u => ({
        userId: u._id,
        realName: u.realName,
        studentId: u.studentId,
        college: u.college,
        role: u.role,
        status: u.status,
        // 统一字段名
        total: u.rating,
        contest: u.ratingInfo?.contest || 0,
        practice: u.ratingInfo?.problem || 0,
        legacy: u.ratingInfo?.legacy || 0,
        coefficient: u.ratingInfo?.activeCoefficient || 1.0
      }));

    } else {
      // === B. 查询历史赛季 (读 SeasonRating 快照表) ===
      const records = await SeasonRating.find({ season: targetSeason })
        .populate('userId', 'realName studentId college role') // 关联用户信息
        .sort({ finalRating: -1 })
        .lean();

      // 数据归一化
      list = records.map((r: any) => ({
        userId: r.userId?._id,
        realName: r.userId?.realName || '未知用户', // 防止用户被删
        studentId: r.userId?.studentId || 'N/A',
        college: r.userId?.college || '',
        role: r.userId?.role || 'Member',
        status: r.userId?.status || 'Active',
        // 统一字段名
        total: r.finalRating,
        contest: r.contestScore,
        practice: r.practiceScore,
        legacy: 0, // 历史赛季记录里通常不存再上一级的legacy，或者你看需求
        coefficient: 1.0 // 历史赛季默认系数 1.0
      }));
    }

    // 2. 获取所有可用赛季列表 (用于前端下拉框)
    // 简单粗暴：查 SeasonRating 表里的所有 distinct season，加上当前 season
    const pastSeasons = await SeasonRating.distinct('season');
    const allSeasons = Array.from(new Set([...pastSeasons, currentSeason])).sort().reverse();

    success(res, {
      season: targetSeason,
      isCurrent: targetSeason === currentSeason,
      seasons: allSeasons,
      list
    });

  } catch (error: any) {
    fail(res, error.message || '获取排行榜失败', 500);
  }
};