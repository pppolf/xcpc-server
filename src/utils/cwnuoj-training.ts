import axios from 'axios';
import User from '../models/user.model';
import { getTrainingTargetCount } from './training-target';

const OJ_ORIGIN = 'https://oj.cwnupaa.com';

export const parseCWNUOJContestUrl = (value: unknown) => {
  try {
    if (typeof value !== 'string') throw new Error();
    const url = new URL(value.trim());
    const match = /^\/contest\/([a-f\d]{24})\/?$/i.exec(url.pathname);
    if (url.origin !== OJ_ORIGIN || url.username || url.password || !match) throw new Error();
    return { contestId: match[1].toLowerCase(), contestUrl: `${OJ_ORIGIN}/contest/${match[1].toLowerCase()}` };
  } catch {
    throw new Error('请输入有效的协会 OJ 比赛链接：https://oj.cwnupaa.com/contest/比赛ID');
  }
};

const getOJJson = async (path: string) => {
  try {
    const response = await axios.get(`${OJ_ORIGIN}${path}`, {
      headers: { Accept: 'application/json' }, timeout: 15000, maxRedirects: 0,
    });
    if (!response.data || typeof response.data !== 'object' || response.data.error) throw new Error();
    return response.data;
  } catch {
    throw new Error('协会 OJ 数据读取失败，请检查比赛或用户是否公开可访问后重试；原有同步数据未覆盖');
  }
};

export const fetchCWNUOJContest = async (value: unknown) => {
  const parsed = parseCWNUOJContestUrl(value);
  const { tdoc } = await getOJJson(`/contest/${parsed.contestId}`);
  const startTime = new Date(tdoc?.beginAt);
  const endTime = new Date(tdoc?.endAt);
  if (!tdoc || String(tdoc.docId) !== parsed.contestId || !Array.isArray(tdoc.pids)
    || !tdoc.pids.length || new Set(tdoc.pids).size !== tdoc.pids.length
    || !tdoc.pids.every((pid: unknown) => Number.isSafeInteger(pid) && Number(pid) > 0)
    || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())
    || endTime <= startTime || typeof tdoc.title !== 'string') {
    throw new Error('协会 OJ 比赛信息不完整或不可访问');
  }
  return { ...parsed, title: tdoc.title, pids: tdoc.pids as number[], startTime,
    duration: Math.floor((endTime.getTime() - startTime.getTime()) / 1000) };
};

export const fetchCWNUOJAcceptedPids = async (uid: string): Promise<Set<number>> => {
  const body = await getOJJson(`/user/${uid}`);
  // Hydro's public profile includes the complete accepted-problem list, updated
  // for both contest and practice submissions. Do not use the guest board's
  // accepted:false values: that page requires a session for UID queries.
  if (String(body.udoc?._id) !== uid || !Array.isArray(body.pdocs)
    || !body.pdocs.every((problem: any) => Number.isSafeInteger(problem?.docId))) {
    throw new Error(`协会 OJ 用户 ${uid} 的通过题目不可读取；原有同步数据未覆盖`);
  }
  return new Set(body.pdocs.map((problem: any) => problem.docId));
};

export const parseAndSyncCWNUOJRank = async (training: any) => {
  const contest = await fetchCWNUOJContest(training.cwnuojContestUrl);
  const users = await User.find({ status: 'Active', role: { $ne: 'Teacher' } });
  const validUid = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
  const uids = [...new Set(users.map(user => String(user.ojInfo?.cwnuoj || '').trim()).filter(validUid))];
  const acceptedByUid = new Map<string, Set<number>>();
  // Bound concurrency to avoid flooding the OJ when refreshing the whole team.
  for (let index = 0; index < uids.length; index += 5) {
    const batch = await Promise.all(uids.slice(index, index + 5).map(async uid =>
      [uid, await fetchCWNUOJAcceptedPids(uid)] as const));
    for (const [uid, accepted] of batch) acceptedByUid.set(uid, accepted);
  }

  const ranklist = users.map(user => {
    const uid = String(user.ojInfo?.cwnuoj || '').trim();
    const accepted = acceptedByUid.get(uid);
    const problemStatus: Record<string, { accepted: boolean; time: number }> = {};
    contest.pids.forEach((pid, index) => {
      problemStatus[String(index)] = { accepted: accepted?.has(pid) ?? false, time: 0 };
    });
    const solved = Object.values(problemStatus).filter(status => status.accepted).length;
    const targetCount = getTrainingTargetCount(training, user);
    const syncStatus = !uid ? 'unbound' : !validUid(uid) ? 'invalid-id' : 'synced';
    return { userId: user._id, realName: user.realName, trainingTeam: user.trainingTeam,
      vjudgeHandle: uid, cwnuojUid: uid, syncStatus, targetCount, solved, penalty: 0,
      isAK: syncStatus === 'synced' && solved >= contest.pids.length,
      isPassed: syncStatus === 'synced' && solved >= targetCount, problemStatus };
  });

  // Do not mutate or save anything until every remote request has succeeded.
  training.cwnuojContestId = contest.contestId;
  training.cwnuojContestUrl = contest.contestUrl;
  training.cwnuojProblemIds = contest.pids;
  if (!training.title?.trim()) training.title = contest.title;
  training.problemCount = contest.pids.length;
  training.startTime = contest.startTime;
  training.duration = contest.duration;
  training.lastSyncedAt = new Date();
  training.ranklist = ranklist;
  training.markModified('ranklist');
  await training.save();
  return training;
};
