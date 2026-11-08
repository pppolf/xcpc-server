import User from '../models/user.model';
import Submission from '../models/submission.model';
import { crawlCWNUOJ, schoolOjUid } from '../utils/crawlers/cwnuoj';

const userTasks = new Map<string, Promise<{ new: number; total: number }>>();
export const syncSchoolOjTracker = (userId: string) => {
  const pending = userTasks.get(userId);
  if (pending) return pending;
  const task = (async () => {
    const user = await User.findById(userId).select('ojInfo.cwnuoj');
    if (!user) throw new Error('用户不存在');
    const binding = user.ojInfo?.cwnuoj;
    const uid = schoolOjUid(binding);
    const rows = await crawlCWNUOJ(uid);
    if (!(await User.exists({ _id: userId, 'ojInfo.cwnuoj': binding }))) {
      throw new Error('学校 OJ 绑定已改变，请按新 UID 重新同步');
    }
    const existing = await Submission.find({ userId, platform: 'CWNUOJ' })
      .select('problemId solveTime remoteId sourceAccount difficulty rawDifficulty tags')
      .lean();
    const byPid = new Map(existing.map((row) => [row.problemId, row]));
    const operations = rows.map((row) => {
      const { fetchedAt, ...submission } = row;
      const previous = byPid.get(row.problemId);
      const sameAccount = previous?.sourceAccount === uid;
      const keepEarlier = sameAccount && previous.solveTime < row.solveTime;
      return {
        updateOne: {
          filter: { userId: user._id, platform: 'CWNUOJ' as const, problemId: row.problemId },
          update: {
            $set: {
              ...submission,
              userId: user._id,
              solveTime: keepEarlier ? previous.solveTime : row.solveTime,
              remoteId: keepEarlier ? previous.remoteId : row.remoteId,
              // An unavailable difficulty page must not erase known metadata.
              ...(row.rawDifficulty === 'N/A' && sameAccount && previous.difficulty > 0
                ? {
                    difficulty: previous.difficulty,
                    rawDifficulty: previous.rawDifficulty,
                    tags: previous.tags,
                  }
                : {}),
            },
          },
          upsert: true,
        },
      };
    });
    const result = operations.length ? await Submission.bulkWrite(operations, { ordered: false }) : null;
    await Submission.deleteMany({
      userId,
      platform: 'CWNUOJ',
      sourceAccount: uid,
      problemId: { $nin: rows.map((row) => row.problemId) },
    });
    const updated = await User.updateOne(
      { _id: userId, 'ojInfo.cwnuoj': binding },
      {
        $set: {
          schoolOjTracker: { accountId: uid, lastSyncedAt: new Date(), solvedCount: rows.length },
        },
      },
    );
    if (!updated.matchedCount) throw new Error('学校 OJ 绑定已改变，请按新 UID 重新同步');
    return { new: result?.upsertedCount || 0, total: rows.length };
  })();
  userTasks.set(userId, task);
  void task.finally(() => userTasks.delete(userId)).catch(() => {});
  return task;
};

let batchTask: Promise<{ total: number; successCount: number; failCount: number }> | undefined;
export const syncAllSchoolOjTrackers = (onlyIfStale = false) => {
  if (batchTask) return batchTask;
  batchTask = (async () => {
    const users = await User.find({ role: { $ne: 'Teacher' }, 'ojInfo.cwnuoj': { $nin: ['', null] } })
      .select('_id ojInfo.cwnuoj schoolOjTracker')
      .lean();
    let successCount = 0;
    let failCount = 0;
    for (const user of users) {
      try {
        const uid = schoolOjUid(user.ojInfo?.cwnuoj);
        if (
          onlyIfStale &&
          user.schoolOjTracker?.accountId === uid &&
          Date.now() - new Date(user.schoolOjTracker.lastSyncedAt).getTime() < 20 * 3600000
        )
          continue;
        await syncSchoolOjTracker(String(user._id));
        successCount++;
      } catch (error) {
        failCount++;
        console.warn(
          `[CWNUOJ Tracker] User ${user._id}: ${error instanceof Error ? error.message : '同步失败'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const result = { total: users.length, successCount, failCount };
    console.log('[CWNUOJ Tracker] 自动同步完成', result);
    return result;
  })();
  void batchTask
    .finally(() => {
      batchTask = undefined;
    })
    .catch(() => {});
  return batchTask;
};
