import { Request, Response } from 'express';
import { getMonthSnapshot } from '../services/rating.service';
import { success, fail } from '../utils/response';

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