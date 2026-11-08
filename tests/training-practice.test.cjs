const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTrainingPracticeUrl, resolveTrainingPracticeUrl } = require('../src/utils/training-practice');

test('practice links open the contest details for synced sources', () => {
  const id = '6adb59680b835c39ff13486c';
  assert.equal(resolveTrainingPracticeUrl({ platform:'CWNUOJ', cwnuojContestId:id }),
    `https://oj.cwnupaa.com/contest/${id}`);
  assert.equal(resolveTrainingPracticeUrl({
    platform:'CWNUOJ', cwnuojContestUrl:`https://oj.cwnupaa.com/contest/${id}/?ref=legacy`,
  }), `https://oj.cwnupaa.com/contest/${id}`);
  assert.equal(resolveTrainingPracticeUrl({ platform:'NOWCODER', vjudgeContestId:'135882' }),
    'https://ac.nowcoder.com/acm/contest/135882');
  assert.equal(resolveTrainingPracticeUrl({ platform:'VJUDGE', vjudgeContestId:'414946' }),
    'https://vjudge.net/contest/414946');
  assert.equal(resolveTrainingPracticeUrl({
    platform:'VP_SYSTEM', vpContestUrl:`https://oj.cwnupaa.com/d/xcpc/contest/${id}`,
  }), `https://oj.cwnupaa.com/d/xcpc/contest/${id}`);
});

test('admin-defined practice links take priority and unsafe URLs are rejected', () => {
  const custom = 'https://www.example.org/problem-set/21';
  assert.equal(resolveTrainingPracticeUrl({
    platform:'VJUDGE', vjudgeContestId:'414946', practiceUrl:custom,
  }), custom);
  assert.equal(resolveTrainingPracticeUrl({ platform:'ASSOCIATION_BOARD' }), null);
  assert.equal(parseTrainingPracticeUrl('  '), null);
  assert.equal(parseTrainingPracticeUrl(null), null);
  for (const value of ['javascript:alert(1)', '//example.org', 'https://name:pass@example.org', 123]) {
    assert.throws(() => parseTrainingPracticeUrl(value));
  }
});
