import { Request, Response } from 'express';
import Training from '../models/training.model';
import { parseAndSyncRank } from '../utils/vjudge';
import { parseAndSyncNowCoderRank } from '../utils/nowcoder-training';
import { success, fail } from '../utils/response';
import User from '../models/user.model';
import { getTrainingTargetCount } from '../utils/training-target';
import { parseAndSyncCWNUOJRank } from '../utils/cwnuoj-training';
import { buildTrainingFilter } from '../utils/training-filter';
import { parseAndSyncAssociationBoard } from '../utils/association-board-training';
import { presentTraining, presentTrainings } from '../utils/training-presenter';
import { isSystemAccount } from '../services/auth.service';
import { getTermCatalog, validateTrainingTermId, buildTrainingTermFilter, TermError } from '../services/term.service';
import { parseAndSyncVpHistory } from '../utils/vp-system-training';
import { parseTrainingPracticeUrl } from '../utils/training-practice';

const validateProblemSetterIds = async (value: unknown): Promise<string[]> => {
  if (!Array.isArray(value) || value.length > 1000
    || value.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) {
    throw new Error('请从系统队员中选择出题人，每场最多 1000 人');
  }
  const ids = [...new Set(value.map(id => id.toLowerCase()))];
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } }).select('username').lean();
  if (users.length !== ids.length || users.some(user => isSystemAccount(user.username))) {
    throw new Error('所选出题人不存在或为系统账号，请重新选择');
  }
  return ids;
};

export const getProblemSetterOptions = async (req: Request, res: Response) => {
  if (req.query.keyword !== undefined && (typeof req.query.keyword !== 'string' || req.query.keyword.length > 100)) {
    return fail(res, '搜索内容格式不正确', 400, 400);
  }
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
  const pattern = { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  try {
    const users = await User.find(keyword ? { $or: [{ realName: pattern }, { studentId: pattern }, { username: pattern }] } : {})
      .select('realName studentId username status').sort({ status: 1, studentId: 1 }).limit(50).lean();
    success(res, users.filter(user => !isSystemAccount(user.username)).map(user => ({
      _id: String(user._id), realName: user.realName, studentId: user.studentId, status: user.status,
    })));
  } catch {
    fail(res, '队员搜索失败，请稍后重试', 500, 500);
  }
};

export const getTrainings = async (req: Request, res: Response) => {
  let filter;
  try {
    filter = buildTrainingFilter(req.query);
  } catch (e: any) {
    return fail(res, e.message, 400, 400);
  }
  try {
    const { terms } = await getTermCatalog();
    try {
      filter = { ...filter, ...buildTrainingTermFilter(req.query.termId, terms) };
    } catch (error: any) {
      return fail(res, error.message, 400, 400);
    }
    const list = await Training.find(filter).sort({ startTime: -1 });
    success(res, await presentTrainings(list, terms));
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const getTrainingDetail = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id).lean();
    if (!training) return fail(res, '训练不存在');
    success(res, await presentTraining(training));
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const createTraining = async (req: Request, res: Response) => {
  let problemSetterIds;
  let termId;
  let practiceUrl;
  try {
    practiceUrl = parseTrainingPracticeUrl(req.body?.practiceUrl ?? null);
    problemSetterIds = await validateProblemSetterIds(req.body?.problemSetterIds ?? []);
    termId = await validateTrainingTermId(req.body?.termId);
  } catch (e: any) {
    return fail(res, e.message, 400, 400);
  }
  try {
    const data = { ...req.body, problemSetterIds, termId, practiceUrl, ranklist: [] };
    if (['CWNUOJ', 'ASSOCIATION_BOARD', 'VP_SYSTEM'].includes(req.body?.platform)) {
      const training = new Training(data);
      if (training.platform === 'CWNUOJ') await parseAndSyncCWNUOJRank(training);
      else if (training.platform === 'ASSOCIATION_BOARD') await parseAndSyncAssociationBoard(training);
      else await parseAndSyncVpHistory(training);
      return success(res, await presentTraining(training));
    }
    const training = (await Training.create(data)) as any;

    if (training.platform === 'VJUDGE' && training.vjudgeContestId) {
      try {
        await parseAndSyncRank(training);
      } catch (err) {
        console.error('初始同步失败，请手动刷新', err);
      }
    }

    success(res, await presentTraining(training));
  } catch (e: any) {
    fail(res, e.message);
  }
};

export const refreshTraining = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return fail(res, '未找到记录');
    if (training.platform === 'VP_SYSTEM') return success(res, await presentTraining(await parseAndSyncVpHistory(training)));

    if (training.platform === 'VJUDGE') {
      const updated = await parseAndSyncRank(training);
      return success(res, await presentTraining(updated));
    }

    if (training.platform === 'NOWCODER') {
      const updated = await parseAndSyncNowCoderRank(training);
      return success(res, await presentTraining(updated));
    }

    if (training.platform === 'CWNUOJ') {
      return success(res, await presentTraining(await parseAndSyncCWNUOJRank(training)));
    }
    if (training.platform === 'ASSOCIATION_BOARD') {
      return success(res, await presentTraining(await parseAndSyncAssociationBoard(training)));
    }

    success(res, await presentTraining(training));
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
      isPassed: (!rawItem.syncStatus || rawItem.syncStatus === 'synced') && Number(rawItem.solved || 0) >= targetCount,
    };
  });

  training.markModified('ranklist');
  await training.save();
};

export const updateTraining = async (req: Request, res: Response) => {
  let problemSetterIds;
  let termId;
  let practiceUrl: string | null | undefined;
  if (req.body?.practiceUrl !== undefined) {
    try {
      practiceUrl = parseTrainingPracticeUrl(req.body.practiceUrl);
    } catch (e: any) {
      return fail(res, e.message, 400, 400);
    }
  }
  if (req.body?.termId !== undefined) {
    try {
      termId = await validateTrainingTermId(req.body.termId);
    } catch (error) {
      const status = error instanceof TermError ? error.status : 500;
      return fail(res, error instanceof TermError ? error.message : '学期信息读取失败', status, status);
    }
  }
  if (req.body?.problemSetterIds !== undefined) {
    try {
      problemSetterIds = await validateProblemSetterIds(req.body.problemSetterIds);
    } catch (e: any) {
      return fail(res, e.message, 400, 400);
    }
  }
  try {
    const { id } = req.params;
    const training = await Training.findById(id);

    if (!training) return fail(res, '记录不存在');
    if (!training.termId && termId === undefined) return fail(res, '请选择所属计分学期', 400, 400);
    const previousPlatform = training.platform;
    // Ranklists can only be written by a source sync or the import endpoint.
    const { ranklist, problemSetters, practiceUrl: _, ...changes } = req.body ?? {};
    training.set({
      ...changes,
      ...(problemSetterIds ? { problemSetterIds } : {}),
      ...(termId !== undefined ? { termId } : {}),
      ...(practiceUrl !== undefined ? { practiceUrl } : {}),
    });
    if (previousPlatform !== training.platform) {
      training.ranklist = [];
      training.lastSyncedAt = undefined;
      if (previousPlatform === 'CWNUOJ') {
        training.cwnuojContestId = undefined;
        training.cwnuojContestUrl = undefined;
        training.cwnuojProblemIds = undefined;
      }
      if (previousPlatform === 'ASSOCIATION_BOARD') {
        training.associationBoardId = undefined;
        training.associationBoardUrl = undefined;
        training.associationBoardProblems = undefined;
        training.associationBoardType = undefined;
        training.associationBoardScope = undefined;
        training.associationBoardFrozen = undefined;
      }
      if (previousPlatform === 'VP_SYSTEM') {
        training.vpContestUrl = undefined;
        training.vpProblems = undefined;
        training.vpFrozen = undefined;
        training.vpIncludePractice = false;
      }
    }
    if (training.platform === 'CWNUOJ') {
      return success(res, await presentTraining(await parseAndSyncCWNUOJRank(training)));
    }
    if (training.platform === 'ASSOCIATION_BOARD') {
      return success(res, await presentTraining(await parseAndSyncAssociationBoard(training)));
    }
    if (training.platform === 'VP_SYSTEM') return success(res, await presentTraining(await parseAndSyncVpHistory(training)));
    await training.save();

    await recalculateRanklistTargets(training);
    success(res, await presentTraining(training));
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

    success(res, await presentTraining(training));
  } catch (e: any) {
    fail(res, e.message);
  }
};
