import { Request, Response } from 'express';
import { getCurrentSeason, updateCurrentSeason } from '../services/config.service';
import { success, fail } from '../utils/response';
import MonthlySnapshot from '../models/monthly-snapshot.model'
import User from '../models/user.model';
import * as ratingService from '../services/rating.service';

// 获取当前赛季
export const getSeason = (req: Request, res: Response) => {
  success(res, { season: getCurrentSeason() });
};

// 修改赛季 (危险操作)
export const setSeason = async (req: Request, res: Response) => {
  try {
    const { season } = req.body;
    if (!season || !/^\d{4}-\d{4}$/.test(season)) {
      return fail(res, '赛季格式不正确，应为 YYYY-YYYY');
    }

    const newSeason = await updateCurrentSeason(season);
    
    // TODO: 这里通常需要触发"赛季归档"逻辑，把旧赛季的分数存入 SeasonRating 表
    // 这属于高级功能，先留坑
    
    success(res, { season: newSeason }, '赛季切换成功');
  } catch (error: any) {
    fail(res, error.message || '设置失败', 500);
  }
};

export const initSnapshots = async (req: Request, res: Response) => {
  const now = new Date();
  const users = await User.find({ role: { $ne: 'Teacher' } });
  let count = 0;
  
  for (const user of users) {
    await MonthlySnapshot.create({
      userId: user._id,
      season: getCurrentSeason(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      totalSolved: user.problemNumber
    });
    count++;
  }
  success(res, count, '快照初始化完成');
};

// [调试用] 强制触发上月结算
export const forceSettle = async (req: Request, res: Response) => {
  try {
    const count = await ratingService.batchSettleLastMonth();
    success(res, { count }, '强制结算成功');
  } catch (error: any) {
    fail(res, error.message);
  }
};