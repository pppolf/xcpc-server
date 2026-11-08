import { Types } from 'mongoose';
import GlobalSetting from '../models/global-setting.model';
import Submission from '../models/submission.model';
import TermScoreReview from '../models/term-score-review.model';
import Training from '../models/training.model';
import { buildTrainingTermFilter, getTermCatalog, TermError, type TrainingTerm } from './term.service';
import {
  eventEnded, eventInfo, eventStarted, fallbackAssessment, getAssessmentScores, getTrainingScore, indexRows,
  PRACTICE_PLATFORMS, PRACTICE_TARGET, SCORE_WEIGHTS, totalScore,
  type ItemReview, type PracticePlatform, type ScoreEvent, type ScoreMember,
} from '../utils/term-score';

const assessmentKey = (termId: string) => `TERM_SCORE_ASSESSMENT:${termId}`;
const shanghaiDay = (date: string) => new Date(`${date}T00:00:00+08:00`);

export const selectScoreTerm = async (termId: unknown) => {
  const { terms } = await getTermCatalog();
  if (termId === undefined) return { terms, term: terms[0] ?? null };
  if (typeof termId !== 'string') throw new TermError('学期参数不正确');
  const term = terms.find(candidate => candidate._id === termId);
  if (!term) throw new TermError('所选学期不存在', 404);
  return { terms, term };
};

const scoreTermFilter = (term: TrainingTerm, terms: TrainingTerm[]) =>
  buildTrainingTermFilter(term._id, terms);

export const getScoreEvent = async (term: TrainingTerm, terms: TrainingTerm[], id: string) =>
  Training.findOne({ _id: id, ...scoreTermFilter(term, terms) })
    .select('type problemCount startTime duration').lean();

export const setMainAssessment = async (termId: string, eventId: string) => {
  await GlobalSetting.updateOne({ key: assessmentKey(termId) },
    { $set: { value: eventId }, $setOnInsert: { description: '学期成绩统一考核赛' } }, { upsert: true });
};

const loadPractice = async (members: ScoreMember[], term: TrainingTerm, now: number) => {
  const result = new Map<string, Partial<Record<PracticePlatform, number>>>();
  if (!members.length) return result;
  const start = shanghaiDay(term.startTime);
  const next = term.nextStartTime ? shanghaiDay(term.nextStartTime).getTime() : now;
  const end = new Date(Math.min(now, next));
  if (end <= start) return result;
  const membersById = new Map(members.map(member => [String(member._id), member]));
  // Submission is unique by member, platform and problem ID, with the earliest known AC.
  const grouped = await Submission.aggregate<{
    _id: { userId: Types.ObjectId; platform: PracticePlatform; sourceAccount?: string };
    count: number;
  }>([
    { $match: {
      userId: { $in: [...membersById.keys()].map(id => new Types.ObjectId(id)) },
      platform: { $in: PRACTICE_PLATFORMS },
      solveTime: { $gte: start, $lt: end },
    } },
    { $group: {
      _id: { userId: '$userId', platform: '$platform', sourceAccount: '$sourceAccount' },
      count: { $sum: 1 },
    } },
  ]);
  for (const { _id: { userId, platform, sourceAccount }, count } of grouped) {
    const id = String(userId);
    if (platform === 'CWNUOJ') {
      const uid = membersById.get(id)?.ojInfo?.cwnuoj?.trim();
      if (!uid || sourceAccount !== uid) continue;
    }
    const counts = result.get(id) || {};
    counts[platform] = (counts[platform] || 0) + count;
    result.set(id, counts);
  }
  return result;
};

export const loadTermScores = async (term: TrainingTerm, terms: TrainingTerm[], members: ScoreMember[]) => {
  const now = Date.now();
  const [events, selected, reviewRows, practiceCounts] = await Promise.all([
    Training.find(scoreTermFilter(term, terms))
      .select('title startTime duration type platform problemCount targetCount targetCountFirst targetCountSecond problemSetterIds ranklist associationBoardFrozen associationBoardType vpFrozen')
      .sort({ startTime: 1, _id: 1 }).lean(),
    GlobalSetting.findOne({ key: assessmentKey(term._id) }).select('value').lean(),
    TermScoreReview.find({ termId: term._id }).lean(),
    loadPractice(members, term, now),
  ]);
  const candidates = events.filter(event => event.type === 'ASSESSMENT');
  const main = candidates.find(event => String(event._id) === selected?.value) ?? candidates[0];
  const reviews = new Map<string, Map<string, ItemReview>>();
  for (const entry of reviewRows) {
    const byMember = reviews.get(entry.itemId) || new Map<string, ItemReview>();
    byMember.set(String(entry.userId), {
      status: entry.status, solved: entry.solved, penalty: entry.penalty, note: entry.note,
    });
    reviews.set(entry.itemId, byMember);
  }
  const trainingEvents = events.filter(event => event.type !== 'ASSESSMENT').map((event: ScoreEvent) => ({
    event, index: indexRows(event), reviews: reviews.get(String(event._id)),
  }));
  const assessment = main ? getAssessmentScores(main, reviews.get(String(main._id)) || new Map(), now) : null;
  const mainInfo = main ? eventInfo(main) : null;
  const mainStarted = main ? eventStarted(main, now) : true;
  const assessmentHint = main ? undefined : '本学期暂无统一考核赛，暂不计分';
  const termOpen = !term.nextStartTime || shanghaiDay(term.nextStartTime).getTime() > now;
  const eventsUpdating = [...trainingEvents.map(({ event }) => event), ...(main ? [main] : [])]
    .some(event => !eventEnded(event, now) || event.associationBoardFrozen || event.vpFrozen);

  const details = members.map(member => {
    const id = String(member._id);
    const trainingItems = trainingEvents.map(({ event, index, reviews: eventReviews }) =>
      getTrainingScore(event, index, member, eventReviews?.get(id) ?? null, now));
    const scored = trainingItems.flatMap(entry => entry.points === null ? [] : [entry.points]);
    const pending = trainingItems.filter(entry => entry.status === 'pending').length;
    const trainingAverage = scored.length
      ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null;
    const trainingPoints = trainingAverage === null ? null : trainingAverage * SCORE_WEIGHTS.training / 100;
    const byPlatform = PRACTICE_PLATFORMS.map(platform => ({
      platform, count: practiceCounts.get(id)?.[platform] ?? 0,
    }));
    const syncedCount = byPlatform.reduce((sum, entry) => sum + entry.count, 0);
    const practiceReview = reviews.get('practice')?.get(id) ?? null;
    const effectiveCount = practiceReview?.status === 'invalidated' ? 0 : practiceReview?.solved ?? syncedCount;
    const practicePoints = Math.min(effectiveCount / PRACTICE_TARGET, 1) * SCORE_WEIGHTS.practice;
    const assessmentItem = assessment?.scores.get(id) ?? fallbackAssessment(mainStarted, assessmentHint);
    const assessmentPoints = assessmentItem.points === null
      ? null : assessmentItem.points * SCORE_WEIGHTS.assessment / 100;
    const totalMax = SCORE_WEIGHTS.practice +
      (trainingPoints === null ? 0 : SCORE_WEIGHTS.training) +
      (assessmentPoints === null ? 0 : SCORE_WEIGHTS.assessment);
    const total = totalScore(trainingPoints ?? 0, practicePoints, assessmentPoints ?? 0);
    const provisional = termOpen || eventsUpdating || totalMax < 100 || pending > 0 ||
      Boolean(assessment?.awaitingSync);
    return {
      member: { id, realName: member.realName, studentId: member.studentId, team: member.trainingTeam },
      total, totalMax, provisional,
      training: { points: trainingPoints, average: trainingAverage, counted: scored.length, pending, items: trainingItems },
      practice: { points: practicePoints, effectiveCount, syncedCount, byPlatform, review: practiceReview },
      assessment: {
        ...assessmentItem, points: assessmentPoints, rawPoints: assessmentItem.points,
        event: mainInfo, participants: assessment?.participants ?? 0,
        awaitingSync: assessment?.awaitingSync ?? 0,
      },
    };
  });
  return { details, assessments: candidates.map(eventInfo), mainAssessmentId: mainInfo?.id ?? null };
};

export type TermScoreDetail = Awaited<ReturnType<typeof loadTermScores>>['details'][number];

export const rankTermScores = (details: TermScoreDetail[]) => {
  const rows = details.map(({ member, total, totalMax, provisional, training, practice, assessment }) => ({
    member, total, totalMax, provisional, trainingPoints: training.points, practicePoints: practice.points,
    practiceCount: practice.effectiveCount, assessmentPoints: assessment.points, assessmentRank: assessment.rank,
  }));
  rows.sort((left, right) => right.total - left.total ||
    left.member.studentId.localeCompare(right.member.studentId));
  let rank = 0;
  return rows.map((row, index) => {
    if (index === 0 || row.total !== rows[index - 1].total) rank = index + 1;
    return { ...row, rank };
  });
};
