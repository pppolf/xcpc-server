import axios from 'axios';
import User from '../models/user.model';
import { getTrainingTargetCount } from './training-target';

const WEBSITE = 'https://www.cwnupaa.com';
const websiteId = (value: unknown): string => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) ? value : '';
};

export const parseAssociationBoardUrl = (value: unknown) => {
  try {
    if (typeof value !== 'string') throw new Error();
    const url = new URL(value.trim());
    const match = /^\/contest\/board\/([1-9]\d{0,18})\/?$/.exec(url.pathname);
    if (![WEBSITE, 'https://cwnupaa.com'].includes(url.origin) || url.username || url.password || !match) throw new Error();
    return { boardId: match[1], boardUrl: `${WEBSITE}/contest/board/${match[1]}` };
  } catch {
    throw new Error('请输入协会官网外榜链接：https://www.cwnupaa.com/contest/board/外榜ID');
  }
};

const parseWebsiteTime = (value: unknown): Date => {
  if (typeof value !== 'string') throw new Error('外榜未返回有效的比赛时间');
  const text = value.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) {
    throw new Error('外榜比赛时间格式异常');
  }
  // The website uses LocalDateTime in Beijing time, independent of host timezone.
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error('外榜比赛时间格式异常');
  return date;
};

const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const parseAndSyncAssociationBoard = async (training: any) => {
  const { boardId, boardUrl } = parseAssociationBoardUrl(training.associationBoardUrl);
  let envelope;
  let personalRows: any[] | undefined;
  try {
    // The website applies its own public/open/frozen rules. Never request an
    // admin view, a resolver, or a timePoint that could alter the current result.
    const response = await axios.get(`${WEBSITE}/api/leaderboard/${boardId}`, {
      params: { scope: 'personal' }, headers: { Accept: 'application/json' },
      timeout: 15000, maxRedirects: 0,
    });
    envelope = response.data;
    // GPLT publishes per-member scores and a separate team aggregate. Use the
    // approved roster and the union of members' accepted problems for team credit.
    if (envelope?.code === 200 && envelope.data?.type === 'GPLT' && envelope.data?.isTeam === 1) {
      if (!Array.isArray(envelope.data.rows)) throw new Error();
      personalRows = envelope.data.rows;
      const teamResponse = await axios.get(`${WEBSITE}/api/leaderboard/${boardId}`, {
        params: { scope: 'team' }, headers: { Accept: 'application/json' },
        timeout: 15000, maxRedirects: 0,
      });
      envelope = teamResponse.data;
    }
  } catch {
    throw new Error('协会官网外榜无法读取，请确认外榜已开放后重试；原有成绩未覆盖');
  }
  if (!envelope || envelope.code !== 200) {
    throw new Error('协会官网拒绝读取外榜，请确认链接正确且外榜已开放；原有成绩未覆盖');
  }
  const board = envelope.data;
  if (!board || websiteId(board.boardId) !== boardId || !Array.isArray(board.problems) || !board.problems.length
    || !Array.isArray(board.rows) || !['XCPC', 'GPLT', 'LANQIAO'].includes(board.type)
    || !['PENDING', 'RUNNING', 'FROZEN', 'ENDED'].includes(board.status)
    || ![0, 1].includes(board.isTeam) || typeof board.title !== 'string' || typeof board.unfrozen !== 'boolean') {
    throw new Error('官网外榜返回的数据不完整，原有成绩未覆盖');
  }
  const problems: { id: string; name: string; score: number }[] = board.problems.map((problem: any) => {
    if (!problem || typeof problem.id !== 'string' || !problem.id.trim() || typeof problem.name !== 'string'
      || !nonnegative(problem.score)) throw new Error('外榜题目信息异常');
    return { id: problem.id, name: problem.name, score: problem.score };
  });
  if (new Set(problems.map(problem => problem.id)).size !== problems.length) throw new Error('外榜题目编号重复');
  const startTime = parseWebsiteTime(board.startTime);
  const endTime = parseWebsiteTime(board.endTime);
  if (endTime <= startTime) throw new Error('外榜比赛起止时间异常');
  const scope = board.isTeam === 1 ? 'team' : 'personal';
  const personalAccepted = new Map<string, Set<string>>();
  if (personalRows) {
    for (const row of personalRows) {
      const id = websiteId(row?.itemId);
      if (!id || personalAccepted.has(id) || !row.problemStatus || typeof row.problemStatus !== 'object'
        || Array.isArray(row.problemStatus)) throw new Error('GPLT 成员题目记录异常，原有统计未覆盖');
      const accepted = new Set<string>();
      for (const problem of problems) {
        const raw = Object.prototype.hasOwnProperty.call(row.problemStatus, problem.id) ? row.problemStatus[problem.id] : undefined;
        if (raw && (!['AC', 'WA', 'PENDING', 'NONE', 'Scored'].includes(raw.status)
          || (raw.status === 'Scored' && !nonnegative(raw.score)))) throw new Error('GPLT 成员成绩异常');
        const maximum = nonnegative(raw?.maxScore) ? raw.maxScore : problem.score;
        if (raw?.status === 'AC' || (raw?.status === 'Scored' && maximum > 0 && raw.score >= maximum)) accepted.add(problem.id);
      }
      personalAccepted.set(id, accepted);
    }
  }
  const rowsByWebsiteId = new Map<string, any[]>();
  for (const row of board.rows) {
    if (!row || !websiteId(row.itemId) || typeof row.name !== 'string'
      || !row.problemStatus || typeof row.problemStatus !== 'object' || Array.isArray(row.problemStatus)) {
      throw new Error('外榜成绩格式异常，原有成绩未覆盖');
    }
    const ids = Array.isArray(row.memberIds) ? row.memberIds.map(websiteId) : scope === 'personal' ? [websiteId(row.itemId)] : null;
    if (!ids || ids.some((id: string) => !id)) throw new Error('该外榜未返回官网用户关联信息，无法准确匹配队员');
    for (const id of new Set<string>(ids)) {
      const rows = rowsByWebsiteId.get(id) || [];
      rows.push(row);
      rowsByWebsiteId.set(id, rows);
    }
    for (const problem of problems) {
      const status = Object.prototype.hasOwnProperty.call(row.problemStatus, problem.id) ? row.problemStatus[problem.id] : undefined;
      if (status && (!['AC', 'WA', 'PENDING', 'NONE', 'Scored'].includes(status.status)
        || (status.status === 'Scored' && !nonnegative(status.score)))) {
        throw new Error('外榜题目成绩异常，原有成绩未覆盖');
      }
    }
  }

  const users = await User.find({ status: 'Active', role: { $ne: 'Teacher' } });
  const boundCounts = new Map<string, number>();
  const getBinding = (user: any) => user.associationIdentity && user.associationIdentity.studentId === user.studentId
    ? websiteId(user.associationIdentity.userId) : '';
  for (const user of users) {
    const id = getBinding(user);
    if (id) boundCounts.set(id, (boundCounts.get(id) || 0) + 1);
  }
  const ranklist = users.map(user => {
    const identity = user.associationIdentity;
    const id = getBinding(user);
    const matches = rowsByWebsiteId.get(id) || [];
    const syncStatus = !id ? 'unbound' : matches.length > 1 || (boundCounts.get(id) || 0) > 1 ? 'ambiguous' : !matches.length ? 'not-participating' : 'synced';
    const row = syncStatus === 'synced' ? matches[0] : undefined;
    const problemStatus: Record<string, any> = {};
    problems.forEach((problem, index) => {
      const raw = row && Object.prototype.hasOwnProperty.call(row.problemStatus, problem.id) ? row.problemStatus[problem.id] : undefined;
      const maxScore = nonnegative(raw?.maxScore) ? raw.maxScore : problem.score;
      const accepted = scope === 'team' && board.type === 'GPLT'
        ? Boolean(row?.memberIds?.some((memberId: unknown) => personalAccepted.get(websiteId(memberId))?.has(problem.id)))
        : raw?.status === 'AC' || (raw?.status === 'Scored' && maxScore > 0 && raw.score >= maxScore);
      problemStatus[String(index)] = { accepted, time: nonnegative(raw?.timeMillis) ? raw.timeMillis / 1000 : nonnegative(raw?.time) ? raw.time * 60 : 0,
        score: nonnegative(raw?.score) ? raw.score : 0, fullScore: maxScore, status: raw?.status || 'NONE' };
    });
    const solved = Object.values(problemStatus).filter((status: any) => status.accepted).length;
    const targetCount = getTrainingTargetCount(training, user);
    const penalty = nonnegative(row?.penaltyMillis) ? row.penaltyMillis / 1000 : nonnegative(row?.penalty) ? row.penalty * 60 : 0;
    return { userId: user._id, realName: user.realName, trainingTeam: user.trainingTeam,
      associationUserId: id, associationAccount: id ? identity?.account || '' : '',
      resultScope: scope, sourceName: row?.name || '', sourceRank: row?.rank, sourceScore: row?.totalScore,
      syncStatus, targetCount, solved, penalty, problemStatus,
      isAK: syncStatus === 'synced' && solved === problems.length,
      isPassed: syncStatus === 'synced' && solved >= targetCount };
  });

  // Preserve the previous snapshot on every upstream or identity-format error.
  training.associationBoardId = boardId;
  training.associationBoardUrl = boardUrl;
  training.associationBoardProblems = problems;
  training.associationBoardType = board.type;
  training.associationBoardScope = scope;
  training.associationBoardFrozen = !board.unfrozen && ['FROZEN', 'ENDED'].includes(board.status);
  if (!training.title?.trim()) training.title = typeof board.sessionName === 'string' && board.sessionName.trim() ? board.sessionName.trim() : board.title;
  training.startTime = startTime;
  training.duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
  training.problemCount = problems.length;
  training.ranklist = ranklist;
  training.lastSyncedAt = new Date();
  training.markModified('ranklist');
  await training.save();
  return training;
};
