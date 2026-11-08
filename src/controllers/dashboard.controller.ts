import { Request, Response } from 'express';
import User from '../models/user.model';
import Training from '../models/training.model';
import { getCurrentSeason } from '../services/config.service';
import { success, fail } from '../utils/response';

export const getDashboardStats = async (_req: Request, res: Response) => {
  try {
    const [summary, totalTrainings, recentTrainings] = await Promise.all([
      User.aggregate([
        { $match: { role: { $ne: 'Teacher' } } },
        { $group: {
          _id: null,
          totalMembers: { $sum: 1 },
          activeMembers: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } },
          retiredMembers: { $sum: { $cond: [{ $eq: ['$status', 'Retired'] }, 1, 0] } },
          firstTeam: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Active'] }, { $eq: ['$trainingTeam', 'First'] }] }, 1, 0] } },
          secondTeam: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Active'] }, { $eq: ['$trainingTeam', 'Second'] }] }, 1, 0] } },
          totalProblems: { $sum: '$problemNumber' },
        } },
        { $project: { _id: 0 } },
      ]),
      Training.countDocuments(),
      Training.find().sort({ startTime: -1 }).limit(5)
        .select('title type platform startTime duration problemCount').lean(),
    ]);
    success(res, { totalMembers: 0, activeMembers: 0, retiredMembers: 0, firstTeam: 0, secondTeam: 0,
      totalProblems: 0, ...summary[0], totalTrainings, recentTrainings, currentSeason: getCurrentSeason() });
  } catch {
    fail(res, '控制台数据暂时无法读取', 500, 500);
  }
};
