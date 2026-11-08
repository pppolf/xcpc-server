const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assessmentPoints, getAssessmentScores, getTrainingScore, indexRows, PRACTICE_TARGET, totalScore,
} = require('../src/utils/term-score');
const { loadTermScores, rankTermScores } = require('../src/services/term-score.service');

const now = Date.parse('2026-10-15T12:00:00Z');
const member = { _id: 'one', realName: '队员', studentId: '001', trainingTeam: 'Second' };
const contest = {
  _id: 'contest', title: '月赛', startTime: new Date('2026-10-15T08:00:00Z'),
  duration: 7200, platform: 'VJUDGE', problemCount: 8,
  targetCount: 3, targetCountFirst: 4, targetCountSecond: 3,
  ranklist: [{
    userId: 'one', trainingTeam: 'First', solved: 4,
    problemStatus: Object.fromEntries([800, 1800, 5600, 7800].map((time, index) => [index, { accepted: true, time }])),
  }],
};
const trainingScore = (event, review = null) =>
  getTrainingScore(event, indexRows(event), member, review, now);

test('training uses the recorded tier and synchronized passes, capped at 100', () => {
  const result = trainingScore(contest);
  assert.equal(result.team, 'First');
  assert.equal(result.target, 4);
  assert.equal(result.solved, 4);
  assert.equal(result.points, 100);
  assert.equal(trainingScore(contest, { status: 'scored', solved: 5 }).points, 100);
});

test('training distinguishes approved leave, absence, setter exemption, and unavailable results', () => {
  assert.equal(trainingScore(contest, { status: 'excused' }).points, null);
  assert.equal(trainingScore(contest, { status: 'absent' }).points, 0);
  const setter = trainingScore({ ...contest, problemSetterIds: ['one'], ranklist: [] }, { status: 'exempt' });
  assert.equal(setter.solved, contest.problemCount);
  assert.equal(setter.points, 100);
  assert.equal(trainingScore({ ...contest, problemSetterIds: ['one'], startTime: new Date(now + 1000) }).points, null);
  const school = { ...contest, platform: 'CWNUOJ', ranklist: [
    { userId: 'one', trainingTeam: 'First', syncStatus: 'synced', solved: 2 },
  ] };
  assert.equal(trainingScore(school).points, 50);
  assert.equal(trainingScore({ ...school, ranklist: [{ userId: 'one', solved: 0, syncStatus: 'unbound' }] }).status, 'pending');
  assert.equal(trainingScore({ ...school, startTime: new Date(now + 1000) }).status, 'upcoming');
  assert.equal(trainingScore({ ...contest, ranklist: [{ userId: 'one', solved: 0, syncStatus: 'synced' }] }).points, 0);
});

test('VP training includes distinct practice passes even when the training view shows contest-only totals', () => {
  const row = {
    userId: 'one', trainingTeam: 'First', syncStatus: 'synced',
    solved: 2, vpContestSolved: 2, vpPracticeSolved: 1,
  };
  const event = { ...contest, platform: 'VP_SYSTEM', ranklist: [row] };
  assert.equal(trainingScore(event).solved, 3);
  assert.equal(trainingScore(event).points, 75);
  row.solved = 3;
  assert.equal(trainingScore(event).solved, 3);
});

test('assessment uses synced individual results, includes zero-solve attendance, and keeps makeup outside the rank pool', () => {
  const event = {
    ...contest, platform: 'ASSOCIATION_BOARD', associationBoardType: 'XCPC',
    ranklist: [
      { userId: 'one', solved: 2, penalty: 3000, resultScope: 'personal', syncStatus: 'synced' },
      { userId: 'two', solved: 2, penalty: 2500, resultScope: 'personal', syncStatus: 'synced' },
      { userId: 'three', solved: 0, penalty: 0, resultScope: 'personal', syncStatus: 'synced' },
      { userId: 'team', solved: 8, penalty: 100, resultScope: 'team', syncStatus: 'synced' },
    ],
  };
  const reviews = new Map([
    ['absent', { status: 'absent' }],
    ['makeup', { status: 'makeup', solved: 2, penalty: 2900 }],
  ]);
  const { scores, participants, awaitingSync } = getAssessmentScores(event, reviews, now);
  assert.equal(participants, 3);
  assert.equal(awaitingSync, 1);
  assert.equal(scores.get('two').points, 100);
  assert.equal(scores.get('one').rank, 2);
  assert.equal(scores.get('three').points, 46);
  assert.equal(scores.get('absent').points, 0);
  assert.equal(scores.get('makeup').rank, 2);
  assert.equal(scores.get('makeup').points, scores.get('one').points);
  assert.equal(assessmentPoints(20, 8), 72);
  assert.equal(assessmentPoints(20, 20), 24);
});

test('rank table sorts current points and shares tied ranks', () => {
  assert.equal(PRACTICE_TARGET, 150);
  assert.equal(totalScore((14 / 15 * 100) * 24 / 100, 70 / 100 * 16, 44 * 60 / 100), 60);
  assert.equal(totalScore(12, 12, 35.9999) < 60, true);
  const detail = (studentId, total) => ({
    member: { studentId }, total, totalMax: 100, provisional: true,
    training: { points: 24 },
    practice: { points: 16, effectiveCount: 100 },
    assessment: { points: 60, rank: 1 },
  });
  assert.deepEqual(
    rankTermScores([detail('003', 65.001), detail('002', 0), detail('004', 65.004), detail('001', 65.004)])
      .map(row => [row.member.studentId, row.rank]),
    [['001', 1], ['004', 1], ['003', 3], ['002', 4]],
  );
});

test('NowCoder stores contest ACs separately while training uses synchronized passes', async t => {
  const axios = require('axios');
  const User = require('../src/models/user.model').default;
  const { parseAndSyncNowCoderRank } = require('../src/utils/nowcoder-training');
  t.mock.method(User, 'find', async () => [{ ...member, ojInfo: { nc: '42' } }]);
  t.mock.method(axios, 'get', async () => ({
    data: { data: { rankData: [{ uid: 42, scoreList: [
      { score: 100, fullScore: 100 },
      { score: 0, postContestScore: 100, fullScore: 100 },
    ] }] } },
  }));
  const event = {
    ...contest, platform: 'NOWCODER', nowcoderContestId: '123', problemCount: 2,
    targetCountSecond: 2, markModified() {}, async save() {},
  };
  await parseAndSyncNowCoderRank(event);
  assert.equal(event.ranklist[0].solved, 2);
  assert.equal(trainingScore(event).solved, 2);
  assert.equal(trainingScore(event).points, 100);
  assert.equal(event.ranklist[0].nowcoderContestSolved, 1);
});

test('available scores are totaled immediately, with future trainings and the future assessment excluded', async t => {
  const { Types } = require('mongoose');
  const Training = require('../src/models/training.model').default;
  const GlobalSetting = require('../src/models/global-setting.model').default;
  const Review = require('../src/models/term-score-review.model').default;
  const Submission = require('../src/models/submission.model').default;
  const term = { _id: new Types.ObjectId().toString(), startTime: '2026-09-01', termName: '2026-2027-1' };
  const user = { ...member, _id: new Types.ObjectId(), trainingTeam: 'First' };
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const event = {
    ...contest, platform: 'CWNUOJ', startTime: new Date(now - 3600000),
    ranklist: [{ userId: user._id, solved: 2, syncStatus: 'synced' }],
  };
  const assessment = {
    ...contest, _id: 'assessment', type: 'ASSESSMENT', startTime: new Date(now + 3600000),
    platform: 'ASSOCIATION_BOARD', associationBoardType: 'XCPC',
    ranklist: [{ userId: user._id, solved: 1, penalty: 200, syncStatus: 'synced', resultScope: 'personal' }],
  };
  const upcoming = { ...event, _id: 'upcoming', startTime: new Date(now + 7200000), ranklist: [
    { userId: user._id, solved: 4, syncStatus: 'synced' },
  ] };
  t.mock.method(Training, 'find', () => ({ select: () => ({ sort: () => ({
    lean: async () => [event, { ...event, _id: 'no-data', ranklist: [] }, assessment, upcoming],
  }) }) }));
  t.mock.method(GlobalSetting, 'findOne', () => ({ select: () => ({ lean: async () => null }) }));
  t.mock.method(Review, 'find', () => ({ lean: async () => [] }));
  t.mock.method(Submission, 'aggregate', async () => [{ _id: { userId: user._id, platform: 'CodeForces' }, count: 75 }]);

  const before = (await loadTermScores(term, [term], [user])).details[0];
  assert.equal(before.training.points, 12);
  assert.equal(before.training.counted, 1);
  assert.equal(before.training.pending, 1);
  assert.equal(before.training.items[2].status, 'upcoming');
  assert.equal(before.assessment.status, 'upcoming');
  assert.equal(before.assessment.points, null);
  assert.equal(before.total, 20);
  assert.equal(before.totalMax, 40);

  clock += 3600000;
  const live = (await loadTermScores(term, [term], [user])).details[0];
  assert.equal(live.assessment.points, 60);
  assert.equal(live.total, 80);
  assert.equal(live.totalMax, 100);
  assert.equal(live.provisional, true);
});
