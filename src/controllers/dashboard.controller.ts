import { Request, Response } from 'express';
import User from '../models/user.model';
import Ticket from '../models/ticket.model';
import { success, fail } from '../utils/response';
import Upcoming from '../models/upcoming.model';

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

    // 4. 获取赛事列表 (合并 Manual + Crawled，只取未过期的，按时间排序)
    const now = new Date();
    const nextManualContest = await Upcoming.findOne({
      type: 'Manual',
      startTime: { $gte: now }
    }).sort({ startTime: 1 }); // 按时间升序，取第一个

    const targetContest = nextManualContest ? {
      name: nextManualContest.name,
      date: nextManualContest.startTime
    } : { name: '', date: '' };
    const upcomingContests = await Upcoming.find({ 
      startTime: { $gte: now } // 只查还没结束的
    })
    .sort({ startTime: 1 }) // 最近的在前
    .limit(10) // 只展示最近10场
    .lean();

    success(res, {
      totalProblems,
      totalMembers,
      totalAwards,
      config: {
        targetContest,
        upcomingContests // 返回混合后的列表
      }
    });
  } catch (e: any) {
    console.error('Dashboard Stats Error:', e);
    fail(res, e.message, 500);
  }
};