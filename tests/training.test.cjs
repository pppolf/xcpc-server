const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const GlobalSetting = require('../src/models/global-setting.model').default;
const User = require('../src/models/user.model').default;
const Training = require('../src/models/training.model').default;
const { parseCWNUOJContestUrl, parseAndSyncCWNUOJRank } = require('../src/utils/cwnuoj-training');
const { buildTrainingDateFilter } = require('../src/utils/training-filter');
const { getTrainings, createTraining, updateTraining, refreshTraining } = require('../src/controllers/training.controller');
const contestId = '6adb59680b835c39ff13486c';
const termId = '507f1f77bcf86cd799439011';
const contestUrl = `https://oj.cwnupaa.com/contest/${contestId}`;
const tdoc = { docId: contestId, title: '测试比赛', pids: [720, 721, 722], beginAt: '2026-10-25T11:00:00Z', endAt: '2026-10-25T13:30:00Z' };
const member = (id, uid, team = 'First') => ({ _id: id, realName: id, trainingTeam: team, ojInfo: { cwnuoj: uid } });
const makeTraining = () => ({ platform: 'CWNUOJ', title: '', cwnuojContestUrl: contestUrl, targetCount: 2, targetCountFirst: 3, targetCountSecond: 1, ranklist: [{ original: true }], markModified() {}, saved: false, async save() { this.saved = true; } });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

beforeEach(t => {
  t.mock.method(GlobalSetting, 'findOne', filter => {
    assert.deepEqual(filter, { key: 'TRAINING_TERMS' });
    return { lean: async () => ({ value: {
      terms: [{ _id: termId, termName: '2026-2027-1', startTime: '2026-09-01', websiteTermId: null }],
      lastSyncedAt: null,
    } }) };
  });
});

test('contest URL is validated and normalized before any remote request', () => {
  assert.deepEqual(parseCWNUOJContestUrl(` ${contestUrl.toUpperCase().replace('HTTPS://OJ.CWNUPAA.COM', 'https://oj.cwnupaa.com')}/?x=1#top `), { contestId, contestUrl });
  for (const url of ['http://127.0.0.1/contest/'+contestId, 'https://evil.example/contest/'+contestId, 'https://oj.cwnupaa.com.evil.test/contest/'+contestId, 'https://name:pass@oj.cwnupaa.com/contest/'+contestId, 'https://oj.cwnupaa.com/contest/not-an-id', { url: contestUrl }]) {
    assert.throws(() => parseCWNUOJContestUrl(url), /有效的协会/);
  }
});

test('CWNUOJ sync matches bound numeric IDs, maps original PID order and counts each accepted problem once', async t => {
  t.mock.method(User, 'find', async filter => {
    assert.deepEqual(filter, { status: 'Active', role: { $ne: 'Teacher' } });
    return [member('one', '2'), member('two', '90', 'Second'), member('unbound', ''), member('invalid', 'username')];
  });
  const paths = [];
  t.mock.method(axios, 'get', async (url, options) => {
    paths.push(url); assert.equal(options.headers.Accept, 'application/json');
    if (url === contestUrl) return { data: { tdoc } };
    if (url.endsWith('/user/2')) return { data: { udoc: { _id: 2 }, pdocs: [{ docId: 720 }, { docId: 720 }, { docId: 722 }, { docId: 900 }] } };
    if (url.endsWith('/user/90')) return { data: { udoc: { _id: 90 }, pdocs: [{ docId: 721 }] } };
    throw new Error('unexpected request');
  });
  const training = makeTraining();
  await parseAndSyncCWNUOJRank(training);
  assert.equal(training.saved, true);
  assert.equal(training.problemCount, 3);
  assert.deepEqual(training.cwnuojProblemIds, [720, 721, 722]);
  assert.equal(training.title, '测试比赛');
  assert.equal(training.duration, 9000);
  assert.equal(training.startTime.toISOString(), '2026-10-25T11:00:00.000Z');
  assert.equal(training.ranklist[0].solved, 2);
  assert.equal(training.ranklist[0].isPassed, false);
  assert.equal(training.ranklist[0].problemStatus['2'].accepted, true);
  assert.equal(training.ranklist[1].isPassed, true);
  assert.equal(training.ranklist[2].syncStatus, 'unbound');
  assert.equal(training.ranklist[3].syncStatus, 'invalid-id');
  assert.equal(training.ranklist[2].isPassed, false);
  assert.equal(paths.length, 3);
});

test('network failure or a wrong returned user identity cannot overwrite a previous successful sync', async t => {
  t.mock.method(User, 'find', async () => [member('one', '2')]);
  const remote = t.mock.method(axios, 'get', async url => {
    if (url === contestUrl) return { data: { tdoc } };
    throw new Error('offline');
  });
  const training = makeTraining();
  await assert.rejects(parseAndSyncCWNUOJRank(training), /未覆盖/);
  assert.deepEqual(training.ranklist, [{ original: true }]);
  assert.equal(training.saved, false);
  remote.mock.mockImplementation(async url => url === contestUrl ? { data: { tdoc } } : { data: { udoc: { _id: 99 }, pdocs: [] } });
  await assert.rejects(parseAndSyncCWNUOJRank(training), /未覆盖/);
  assert.equal(training.saved, false);
});

test('a guest board response or HTML is never treated as a zero-solved user', async t => {
  t.mock.method(User, 'find', async () => [member('one', '2')]);
  t.mock.method(axios, 'get', async url => url === contestUrl ? { data: { tdoc } } : { data: { loggedIn: false, selectedUid: null } });
  await assert.rejects(parseAndSyncCWNUOJRank(makeTraining()), /不可读取/);
});

test('create, edit and manual refresh all run the association OJ synchronizer', async t => {
  t.mock.method(User, 'find', async () => [member('507f1f77bcf86cd799439012', '2')]);
  t.mock.method(axios, 'get', async url => url === contestUrl ? { data: { tdoc } } : { data: { udoc: { _id: 2 }, pdocs: [{ docId: 720 }] } });
  const saved = [];
  t.mock.method(Training.prototype, 'save', async function() { saved.push(this); return this; });
  const res = response();
  const fields = { platform: 'CWNUOJ', cwnuojContestUrl: contestUrl, targetCount: 1, termId };
  await createTraining({ body: fields }, res);
  assert.equal(res.body.success, true, res.body.message);
  assert.equal(res.body.data.title, '测试比赛');
  assert.equal(res.body.data.resolvedTermId, termId);
  assert.equal(res.body.data.ranklist[0].solved, 1);
  t.mock.method(Training, 'findById', async () => saved[0]);
  const refreshed = response();
  await refreshTraining({ params: { id: 'id' } }, refreshed);
  assert.equal(refreshed.body.success, true, refreshed.body.message);
  const updated = response();
  await updateTraining({ params: { id: 'id' }, body: { ...fields, targetCountFirst: 1, title: '自定义训练名' } }, updated);
  assert.equal(updated.body.success, true, updated.body.message);
  assert.equal(saved.length, 3);
  assert.equal(saved[2].title, '自定义训练名');
  assert.equal(saved[2].ranklist[0].isPassed, true);
});

test('date ranges support two bounds, one bound, exact timestamps and inclusive Shanghai calendar days', () => {
  assert.deepEqual(buildTrainingDateFilter({}), {});
  let filter = buildTrainingDateFilter({ startDate: '2026-10-25', endDate: '2026-10-25' });
  assert.equal(filter.startTime.$gte.toISOString(), '2026-10-24T16:00:00.000Z');
  assert.equal(filter.startTime.$lt.toISOString(), '2026-10-25T16:00:00.000Z');
  assert.equal(buildTrainingDateFilter({ startDate: '2026-10-25T19:00:00+08:00' }).startTime.$gte.toISOString(), '2026-10-25T11:00:00.000Z');
  assert.equal(buildTrainingDateFilter({ endDate: '2026-10-25T19:00:00Z' }).startTime.$lte.toISOString(), '2026-10-25T19:00:00.000Z');
});

test('invalid dates, object inputs, ambiguous timestamps and inverted ranges are rejected', () => {
  for (const query of [{ startDate: '2026-02-30' }, { startDate: 'not-a-date' }, { endDate: ['2026-10-25'] }, { startDate: { $ne: null } }, { startDate: '2026-10-25T11:00:00' }, { startDate: '2026-10-26', endDate: '2026-10-25' }]) {
    assert.throws(() => buildTrainingDateFilter(query));
  }
});

test('the list query applies time bounds in the database and invalid ranges do not query', async t => {
  const find = t.mock.method(Training, 'find', filter => {
    assert.equal(filter.startTime.$gte.toISOString(), '2026-10-24T16:00:00.000Z');
    return { sort: async order => { assert.deepEqual(order, { startTime: -1 }); return [{ title: 'within range' }]; } };
  });
  const res = response();
  await getTrainings({ query: { startDate: '2026-10-25' } }, res);
  assert.equal(res.body.data[0].title, 'within range');
  const bad = response();
  await getTrainings({ query: { startDate: '2026-10-26', endDate: '2026-10-25' } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(find.mock.callCount(), 1);
});
