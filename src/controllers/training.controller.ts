import { Request, Response } from 'express';
import Training from '../models/training.model';
import { parseAndSyncRank } from '../utils/vjudge';
import { parseAndSyncNowCoderRank } from '../utils/nowcoder-training';
import { success, fail } from '../utils/response';
import User from '../models/user.model';
import { getTrainingTargetCount } from '../utils/training-target';

export const getTrainings = async (_req: Request, res: Response) => {
  try {
    const list = await Training.find().sort({ startTime: -1 });
    success(res, list);
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const getTrainingDetail = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id).lean();
    if (!training) return fail(res, '训练不存在');
    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const createTraining = async (req: Request, res: Response) => {
  try {
    const training = (await Training.create(req.body)) as any;

    if (training.platform === 'VJUDGE' && training.vjudgeContestId) {
      try {
        await parseAndSyncRank(training);
      } catch (err) {
        console.error('初始同步失败，请手动刷新', err);
      }
    }

    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const refreshTraining = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return fail(res, '未找到记录');

    if (training.platform === 'VJUDGE') {
      const updated = await parseAndSyncRank(training);
      return success(res, updated);
    }

    if (training.platform === 'NOWCODER') {
      const updated = await parseAndSyncNowCoderRank(training);
      return success(res, updated);
    }

    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const deleteTraining = async (req: Request, res: Response) => {
  await Training.findByIdAndDelete(req.params.id);
  success(res, '已删除');
};

const recalculateRanklistTargets = async (training: any) => {
  if (!training.ranklist?.length) return;

  const userIds = training.ranklist.map((item: any) => item.userId).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } });
  const userMap = new Map(users.map((user: any) => [String(user._id), user]));

  training.ranklist = training.ranklist.map((item: any) => {
    const rawItem = item.toObject?.() ?? item;
    const user = userMap.get(String(rawItem.userId));
    const targetCount = getTrainingTargetCount(training, user || rawItem);

    return {
      ...rawItem,
      trainingTeam: user?.trainingTeam || rawItem.trainingTeam,
      targetCount,
      isPassed: Number(rawItem.solved || 0) >= targetCount,
    };
  });

  training.markModified('ranklist');
  await training.save();
};

export const updateTraining = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const training = await Training.findByIdAndUpdate(id, req.body, { new: true });

    if (!training) return fail(res, '记录不存在');

    await recalculateRanklistTargets(training);
    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const importTrainingData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const training = await Training.findById(id);
    if (!training) return fail(res, '训练不存在');

    const activeMembers = await User.find({ role: { $ne: 'Teacher' }, status: 'Active' });
    const scoreMap = new Map<string, number>();

    if (content) {
      const lines = content.split('\n');
      lines.forEach((line: string) => {
        const parts = line.trim().split(/\t+|\s+/);
        if (parts.length < 2) return;

        const name = parts[0];
        const solved = parseInt(parts[1]) || 0;
        const studentId = parts[2];

        if (studentId) {
          scoreMap.set(studentId, solved);
        } else {
          scoreMap.set(name, solved);
        }
      });
    }

    training.ranklist = activeMembers.map((user) => {
      let solved = 0;
      if (scoreMap.has(user.studentId)) {
        solved = scoreMap.get(user.studentId) || 0;
      } else if (scoreMap.has(user.realName)) {
        solved = scoreMap.get(user.realName) || 0;
      }

      const targetCount = getTrainingTargetCount(training, user);

      return {
        userId: user._id,
        realName: user.realName,
        trainingTeam: user.trainingTeam,
        targetCount,
        vjudgeHandle: user.studentId,
        solved,
        penalty: 0,
        isAK: solved >= training.problemCount,
        isPassed: solved >= targetCount,
        problemStatus: {},
      };
    });

    training.markModified('ranklist');
    await training.save();

    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};
