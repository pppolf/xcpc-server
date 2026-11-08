import type { ReviewStatus } from '../models/term-score-review.model';
import { getTrainingTargetCount } from './training-target';

export const SCORE_WEIGHTS = { training: 24, practice: 16, assessment: 60 };
export const PRACTICE_TARGET = 150;
export const PRACTICE_PLATFORMS = ['CodeForces', 'AtCoder', 'Luogu', 'NowCoder', 'CWNUOJ'] as const;
export type PracticePlatform = typeof PRACTICE_PLATFORMS[number];

export const totalScore = (training: number, practice: number, assessment: number) =>
  // Discard floating-point noise at the 60-point boundary and for exact ties.
  Number((training + practice + assessment).toFixed(12));

export interface ScoreMember {
  _id: unknown;
  realName: string;
  studentId: string;
  trainingTeam: string;
  ojInfo?: { cwnuoj?: string };
}

interface ResultRow {
  userId?: unknown;
  trainingTeam?: string;
  solved?: number;
  penalty?: number;
  resultScope?: string;
  syncStatus?: string;
  vjudgeHandle?: string;
  vpContestSolved?: number;
  vpPracticeSolved?: number;
  nowcoderContestSolved?: number;
}

export interface ScoreEvent {
  _id: unknown;
  title: string;
  startTime: Date;
  duration: number;
  type?: string;
  platform: string;
  problemCount: number;
  targetCount: number;
  targetCountFirst?: number;
  targetCountSecond?: number;
  problemSetterIds?: unknown[];
  ranklist?: ResultRow[];
  associationBoardFrozen?: boolean;
  associationBoardType?: string;
  vpFrozen?: boolean;
}

export interface ItemReview {
  status: ReviewStatus;
  solved?: number;
  penalty?: number;
  note?: string;
}

type ItemStatus = ReviewStatus | 'pending' | 'upcoming';

export interface ItemScore {
  status: ItemStatus;
  points: number | null;
  solved: number | null;
  penalty: number | null;
  reason: string;
  review: ItemReview | null;
}

type RankedResult = { userId: string; solved: number; penalty: number };

export const scoreIsCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const scoreIsTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const item = (
  status: ItemStatus,
  reason: string,
  review: ItemReview | null = null,
  solved: number | null = null,
  penalty: number | null = null,
  points: number | null = null,
): ItemScore => ({ status, reason, review, solved, penalty, points });

export const eventInfo = (event: ScoreEvent) => ({
  id: String(event._id), title: event.title, startTime: event.startTime, duration: event.duration, problemCount: event.problemCount,
});

export const eventStarted = (event: ScoreEvent, now: number) =>
  event.startTime.getTime() <= now;

export const eventEnded = (event: ScoreEvent, now: number) =>
  eventStarted(event, now) && scoreIsTime(event.duration) &&
  event.startTime.getTime() + event.duration * 1000 <= now;

export const indexRows = (event: ScoreEvent) => {
  const rows = new Map<string, ResultRow>();
  const handles = new Map<string, number>();
  for (const row of event.ranklist || []) {
    if (!row.userId) continue;
    rows.set(String(row.userId), row);
    const handle = row.vjudgeHandle?.trim().toLowerCase();
    if (handle && ['VJUDGE', 'NOWCODER'].includes(event.platform)) {
      handles.set(handle, (handles.get(handle) || 0) + 1);
    }
  }
  return { rows, handles };
};

const duplicateHandle = (index: ReturnType<typeof indexRows>, row?: ResultRow) => {
  const handle = row?.vjudgeHandle?.trim().toLowerCase();
  return Boolean(handle && (index.handles.get(handle) || 0) > 1);
};

const synced = (row: ResultRow) => !row.syncStatus || row.syncStatus === 'synced';

export const getTrainingScore = (
  event: ScoreEvent, index: ReturnType<typeof indexRows>, member: ScoreMember,
  review: ItemReview | null, now: number,
) => {
  const userId = String(member._id);
  const row = index.rows.get(userId);
  const team = row?.trainingTeam || member.trainingTeam;
  const target = getTrainingTargetCount(event, { trainingTeam: team });
  const isProblemSetter = Boolean(event.problemSetterIds?.some(id => String(id) === userId));
  const detail = { ...eventInfo(event), team, target, isProblemSetter };
  const result = (value: ItemScore) => ({ ...detail, ...value });
  if (!eventStarted(event, now)) return result(item('upcoming', '训练尚未开始，暂不计分'));
  if (isProblemSetter) {
    return result(item('scored', '按训练记录计分', null, event.problemCount, null, 100));
  }
  if (review && ['excused', 'exempt'].includes(review.status)) {
    return result(item(review.status, '本场从平均分的场次中剔除', review));
  }
  if (review?.status === 'absent') return result(item('absent', '无故缺席，本场计 0 分', review, null, null, 0));
  if (!scoreIsCount(target) || target < 1 || target > event.problemCount) {
    return result(item('pending', '达标题量配置无效', review));
  }
  if (!review && duplicateHandle(index, row)) {
    return result(item('pending', '比赛账号对应多名队员，暂无可用同步成绩'));
  }
  const noResult = row?.syncStatus === 'not-participating' && eventEnded(event, now);
  // The VP importer records only problems not already accepted in the contest
  // in vpPracticeSolved, even when the training view excludes practice credit.
  const syncedSolved = event.platform === 'VP_SYSTEM' &&
    scoreIsCount(row?.vpContestSolved) && scoreIsCount(row?.vpPracticeSolved)
    ? row.vpContestSolved + row.vpPracticeSolved : row?.solved;
  const solved = review?.status === 'scored' ? review.solved
    : row && synced(row) ? syncedSolved : noResult ? 0 : undefined;
  if (!scoreIsCount(solved)) return result(item('pending', '暂无同步成绩，本场暂不计入平均分', review));

  const reason = review ? '按已登记的通过题数计分'
    : row?.resultScope === 'team' ? '按训练记录的团队过题数计分'
      : noResult ? '已结束，榜单未找到参赛记录，按 0 题计分'
        : '按训练记录计分';
  return result(item('scored', reason, review, solved, null, Math.min(solved / target, 1) * 100));
};

const compareContest = (a: { solved: number; penalty: number }, b: { solved: number; penalty: number }) =>
  b.solved - a.solved || a.penalty - b.penalty;

export const assessmentPoints = (participants: number, rank: number) =>
  20 + Math.floor((80 * (participants - rank + 1)) / participants);

export const getAssessmentScores = (
  event: ScoreEvent, reviews: ReadonlyMap<string, ItemReview>, now: number,
) => {
  const index = indexRows(event);
  const { rows } = index;
  const scores = new Map<string, ItemScore & { rank: number | null }>();
  const candidates: RankedResult[] = [];
  const makeup: RankedResult[] = [];
  const set = (userId: string, score: ItemScore, rank: number | null = null) =>
    scores.set(userId, { ...score, rank });

  if (eventStarted(event, now)) {
    for (const id of new Set([...rows.keys(), ...reviews.keys()])) {
      const review = reviews.get(id) ?? null;
      const row = rows.get(id);
      if (review?.status === 'absent') {
        set(id, item('absent', '无故缺考，考核赛计 0 分', review, null, null, 0));
        continue;
      }
      if (review?.status === 'exempt') {
        set(id, item('exempt', '未纳入本场考核', review));
        continue;
      }
      if (review?.status === 'excused' || (!review && event.problemSetterIds?.some(setter => String(setter) === id))) {
        set(id, item('excused', '等待补测成绩', review));
        continue;
      }
      const hasPersonalResult = row && synced(row) && row.resultScope !== 'team' &&
        !duplicateHandle(index, row) && (
          (event.platform === 'ASSOCIATION_BOARD' && event.associationBoardType === 'XCPC' &&
            row.resultScope === 'personal') ||
          (['VJUDGE', 'NOWCODER'].includes(event.platform) &&
            (row.syncStatus === 'synced' || (row.solved || 0) > 0)) ||
          (event.platform === 'VP_SYSTEM' && row.resultScope === 'personal')
        );
      const contestSolved = event.platform === 'VP_SYSTEM' ? row?.vpContestSolved
        : event.platform === 'NOWCODER' ? row?.nowcoderContestSolved ?? row?.solved : row?.solved;
      const solved = review ? review.solved : hasPersonalResult ? contestSolved : undefined;
      const penalty = review ? review.penalty : hasPersonalResult ? row?.penalty : undefined;
      if (!scoreIsCount(solved) || (review?.status !== 'makeup' && solved > event.problemCount) ||
        !scoreIsTime(penalty) || (!review && solved > 0 && penalty === 0)) {
        set(id, item('pending', '暂无可用于排名的个人过题和罚时记录', review));
        continue;
      }
      const entry = { userId: id, solved, penalty };
      if (review?.status === 'makeup') makeup.push(entry);
      else candidates.push(entry);
    }
  }
  candidates.sort(compareContest);
  const participants = candidates.length;
  let rank = 1;
  candidates.forEach((entry, index) => {
    if (index > 0 && compareContest(candidates[index - 1], entry) !== 0) rank = index + 1;
    const review = reviews.get(entry.userId) ?? null;
    set(entry.userId, item('scored', review ? '按已登记的正赛成绩计分' : '按当前同步的个人过题和罚时计分',
      review, entry.solved, entry.penalty, assessmentPoints(participants, rank)), rank);
  });
  for (const entry of makeup) {
    const review = reviews.get(entry.userId) ?? null;
    if (!participants) {
      set(entry.userId, item('pending', '等待可用于换算的正赛成绩', review, entry.solved, entry.penalty));
      continue;
    }
    const rank = Math.min(participants, candidates.filter(candidate => compareContest(candidate, entry) < 0).length + 1);
    set(entry.userId, item('makeup', '按正赛榜单和有效人数换算', review, entry.solved, entry.penalty,
      assessmentPoints(participants, rank)), rank);
  }
  return { scores, participants, awaitingSync: [...scores.values()].filter(score => score.status === 'pending').length };
};

export const fallbackAssessment = (started: boolean, reason?: string) =>
  ({ ...item(started ? 'pending' : 'upcoming',
    reason || (started ? '暂无可用于排名的同步成绩' : '考核赛尚未开始，暂不计分')), rank: null });
