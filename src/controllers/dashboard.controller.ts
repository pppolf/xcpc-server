import { Request, Response } from 'express';
import User from '../models/user.model';
import Ticket from '../models/ticket.model';
import { success, fail } from '../utils/response';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    // 1. 全队总题量 (保持不变)
    const totalProblemsResult = await User.aggregate([
      { $match: { role: { $ne: 'Teacher' } } },
      { $group: { _id: null, total: { $sum: '$problemNumber' } } }
    ]);
    const totalProblems = totalProblemsResult[0]?.total || 0;

    // 2. 统计奖项认定总数 (状态为 Approved 的工单)
    const totalAwards = await Ticket.countDocuments({ status: 'Approved' });

    // 3. 总人数 (保持不变)
    const totalMembers = await User.countDocuments({ role: { $ne: 'Teacher' } });

    success(res, {
      totalProblems,
      totalMembers,
      totalAwards
    });
  } catch (e: any) {
    console.error('Dashboard Stats Error:', e);
    fail(res, e.message);
  }
};