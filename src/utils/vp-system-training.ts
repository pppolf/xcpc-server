import axios from 'axios';
import User from '../models/user.model';
import { getVpHistoryKey } from '../services/vp-history-config.service';
import { getTrainingTargetCount } from './training-target';

export const parseVpContestUrl = (input: unknown) => {
  try {
    if (typeof input !== 'string' || input.length > 500) throw new Error();
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash)
      throw new Error();
    const host = url.hostname.replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/$/, '');
    const valid =
      host === 'codeforces.com'
        ? /^\/(contest|gym)\/[1-9]\d*$/.test(pathname)
        : ['qoj.ac', 'contest.ucup.ac'].includes(host)
          ? /^\/contest\/[1-9]\d*$/.test(pathname)
          : host === 'ac.nowcoder.com'
            ? /^\/acm\/contest\/[1-9]\d*$/.test(pathname)
            : host === 'oj.cwnupaa.com' && /^\/(?:d\/[^/]+\/)?contest\/[a-f\d]{24}$/i.test(pathname);
    if (!valid) throw new Error();
    return `https://${host}${pathname}`;
  } catch {
    throw new Error('请输入 VP 文档支持的原站比赛链接，不能使用 VP 房间或外榜链接');
  }
};

// Keep the API's 120 requests/minute budget shared across all training imports.
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
const fetchHistory = async (externalId: string, contestUrl: string, apiKey: string): Promise<any> => {
  let release!: () => void;
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const delay = 650 - (Date.now() - lastRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
    let response;
    try {
      response = await axios.get('https://vp.cwnupaa.com/api/external/vp-history', {
        params: { externalId, contestUrl, limit: 1, offset: 0 },
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: 8 * 1024 * 1024,
      });
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 404) return { missingUser: true, records: [] };
      if (status === 401) throw new Error('VP 历史 API Key 无效或已撤销，请在系统设置中重新配置');
      if (status === 429) throw new Error('VP 历史查询已达到频率上限，请至少一分钟后重试；原有统计已保留');
      throw new Error('VP 历史接口暂时无法读取，请确认接口已部署、比赛链接正确后重试；原有统计已保留');
    }
    const data = response.data?.data;
    if (
      !data ||
      String(data.user?.externalId) !== externalId ||
      parseVpContestUrl(data.contestUrl) !== contestUrl ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0 ||
      !Array.isArray(data.records) ||
      data.records.length > 1 ||
      (data.total > 0 && !data.records.length)
    ) {
      throw new Error('VP 历史返回的用户、比赛或记录格式异常，原有统计已保留');
    }
    return data;
  } finally {
    release();
  }
};

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const parseAndSyncVpHistory = async (training: any) => {
  const contestUrl = parseVpContestUrl(training.vpContestUrl);
  const apiKey = await getVpHistoryKey();
  if (!apiKey) throw new Error('请先在系统设置 → 数据接入与密钥中配置 VP 历史只读 API Key');
  const users = await User.find({ status: 'Active', role: { $ne: 'Teacher' } });
  const binding = (user: any) =>
    user.associationIdentity?.studentId === user.studentId &&
    /^[1-9]\d{0,18}$/.test(user.associationIdentity?.userId || '')
      ? (user.associationIdentity.userId as string)
      : '';
  const boundCounts = new Map<string, number>();
  for (const user of users) {
    const id = binding(user);
    if (id) boundCounts.set(id, (boundCounts.get(id) || 0) + 1);
  }
  const ranklist = [];
  let problemLabels: string[] = [];
  let frozen = false;
  for (const user of users) {
    const externalId = binding(user);
    const ambiguous = (boundCounts.get(externalId) || 0) > 1;
    const data = externalId && !ambiguous ? await fetchHistory(externalId, contestUrl, apiKey) : null;
    const record = data?.records[0];
    const syncStatus = !externalId
      ? 'unbound'
      : ambiguous
        ? 'ambiguous'
        : data?.missingUser
          ? 'vp-unbound'
          : !record
            ? 'not-participating'
            : 'synced';
    const targetCount = getTrainingTargetCount(training, user);
    const base = {
      userId: user._id,
      realName: user.realName,
      trainingTeam: user.trainingTeam,
      targetCount,
      associationUserId: externalId,
      associationAccount: externalId ? user.associationIdentity?.account || '' : '',
      syncStatus,
      solved: 0,
      penalty: 0,
      isAK: false,
      isPassed: false,
      problemStatus: {},
    };
    if (!record) {
      ranklist.push(base);
      continue;
    }
    if (
      record.mode !== 'vp' ||
      !['individual', 'team'].includes(record.participantType) ||
      typeof record.id !== 'string' ||
      !record.id ||
      parseVpContestUrl(record.contestUrl) !== contestUrl ||
      !Number.isSafeInteger(record.solved) ||
      record.solved < 0 ||
      !nonnegative(record.penalty) ||
      !Array.isArray(record.problems) ||
      !record.problems.length ||
      record.problems.length > 1000 ||
      record.problems.some(
        (label: unknown) => typeof label !== 'string' || !label.trim() || label.length > 64,
      ) ||
      new Set(record.problems).size !== record.problems.length ||
      !record.cells ||
      typeof record.cells !== 'object' ||
      Array.isArray(record.cells)
    ) {
      throw new Error('VP 历史题目或成绩信息不完整，原有统计已保留');
    }
    if (!problemLabels.length) problemLabels = [...record.problems];
    if (
      record.problems.length !== problemLabels.length ||
      problemLabels.some((label) => !record.problems.includes(label))
    ) {
      throw new Error('队员的 VP 历史题目列表不一致，请先在 VP System 同步完整历史');
    }
    const problemStatus: Record<string, any> = {};
    let contestSolved = 0;
    let practiceSolved = 0;
    problemLabels.forEach((label, index) => {
      const cell = Object.prototype.hasOwnProperty.call(record.cells, label)
        ? record.cells[label]
        : undefined;
      if (
        cell &&
        (typeof cell !== 'object' ||
          Array.isArray(cell) ||
          (cell.solved !== undefined && typeof cell.solved !== 'boolean') ||
          (cell.practiceSolved !== undefined && typeof cell.practiceSolved !== 'boolean') ||
          (cell.solveTime !== undefined && !nonnegative(cell.solveTime)))
      ) {
        throw new Error('VP 每题成绩格式异常，原有统计已保留');
      }
      const accepted = cell?.solved === true;
      const practiced = !accepted && cell?.practiceSolved === true;
      if (accepted) contestSolved++;
      if (practiced) practiceSolved++;
      problemStatus[String(index)] = {
        accepted: accepted || (training.vpIncludePractice && practiced),
        contestAccepted: accepted,
        practiceAccepted: practiced,
        status: accepted ? 'AC' : practiced ? 'PRACTICE' : 'NONE',
        time: nonnegative(cell?.solveTime) ? cell.solveTime * 60 : 0,
        ...(nonnegative(cell?.points) ? { score: cell.points } : {}),
        ...(nonnegative(cell?.maxPoints) ? { fullScore: cell.maxPoints } : {}),
      };
    });
    if (contestSolved !== record.solved) throw new Error('VP 赛中通过题数与每题记录不一致，原有统计已保留');
    frozen ||= record.frozen === true;
    const solved = contestSolved + (training.vpIncludePractice ? practiceSolved : 0);
    ranklist.push({
      ...base,
      solved,
      penalty: record.penalty * 60,
      problemStatus,
      isAK: solved === problemLabels.length,
      isPassed: solved >= targetCount,
      resultScope: record.participantType === 'team' ? 'team' : 'personal',
      sourceName: typeof record.participantLabel === 'string' ? record.participantLabel : '',
      vpRecordId: record.id,
      vpRank: typeof record.rank === 'string' ? record.rank : String(record.rank ?? '—'),
      vpPoints: nonnegative(record.points) ? record.points : undefined,
      vpHistoryCount: data.total,
      vpContestSolved: contestSolved,
      vpPracticeSolved: practiceSolved,
      vpStartedAt:
        typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt))
          ? new Date(record.startedAt)
          : undefined,
    });
  }
  if (!problemLabels.length)
    throw new Error(
      '没有找到可导入的已结束 VP，请确认已关联官网 ID、上传历史且原站比赛链接正确；原有统计已保留',
    );
  // Save only after every upstream request and every identity/result check succeeds.
  training.vpContestUrl = contestUrl;
  training.vpProblems = problemLabels;
  training.vpFrozen = frozen;
  training.problemCount = problemLabels.length;
  training.ranklist = ranklist;
  training.lastSyncedAt = new Date();
  training.markModified('ranklist');
  await training.save();
  return training;
};
