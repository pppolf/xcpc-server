import { Request, Response } from 'express';
import { getCurrentSeason, updateCurrentSeason } from '../services/config.service';
import { success, fail } from '../utils/response';

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