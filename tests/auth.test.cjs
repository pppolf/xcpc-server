const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-auth-test-secret';
const GlobalSetting = require('../src/models/global-setting.model').default;
const User = require('../src/models/user.model').default;
const router = require('../src/routes/user.routes').default;
const { authMiddleware } = require('../src/middlewares/auth.middleware');
const { generateToken, verifyToken } = require('../src/utils/jwt');

let server, base;
const savedEnv = { key: process.env.CWNUPAA_APP_KEY, system: process.env.SYSTEM_LOGIN_USERNAMES };
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/users', router);
  app.get('/protected', authMiddleware, (req, res) => res.json(req.user));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
beforeEach(t => {
  process.env.CWNUPAA_APP_KEY = 'test-private-app-key';
  process.env.SYSTEM_LOGIN_USERNAMES = 'admin';
  t.mock.method(GlobalSetting, 'findOne', () => ({ lean: async () => null }));
});
afterEach(() => {
  for (const [name, value] of [['CWNUPAA_APP_KEY', savedEnv.key], ['SYSTEM_LOGIN_USERNAMES', savedEnv.system]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
const post = async (path, body) => {
  const res = await fetch(`${base}/users/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const user = { _id: 'local-member-id', username: 'local-name', studentId: '00202401', role: 'Captain', realName: '测试队员', password: 'must-never-be-returned' };
const document = value => value && ({ ...value, toObject: () => ({ ...value }) });
const lookup = (t, expected, result = user, selection = '-password') => {
  t.mock.method(User, 'findOneAndUpdate', (filter, update) => {
    assert.deepEqual(filter, { _id: result._id, studentId: result.studentId });
    assert.equal(update.$set.associationIdentity.studentId, result.studentId);
    return { select: async () => document({ ...result, associationIdentity: update.$set.associationIdentity }) };
  });
  return t.mock.method(User, 'findOne', filter => {
    assert.deepEqual(filter, expected);
    return { select: async value => { assert.equal(value, selection); return document(result); } };
  });
};
const upstream = (t, data = { numberId: '00202401' }, code = 200, msg = 'success') =>
  t.mock.method(axios, 'post', async () => ({ data: { code, msg, data: data ? { userId: 42, userAccount: 'website-name', ...data } : data } }));
const loginInput = { loginType: 'password', account: 'website-name', credential: ' website password ' };

test('website password login matches trusted student number and preserves local role and identity', async t => {
  lookup(t, { studentId: '00202401' });
  t.mock.method(axios, 'post', async (url, payload, options) => {
    assert.equal(url, 'https://www.cwnupaa.com/api/user/external/login');
    assert.deepEqual(payload, { ...loginInput, appKey: 'test-private-app-key' });
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.timeout, 10000);
    return { data: { code: 200, data: { userId: 42, numberId: '00202401', userAccount: 'unrelated-name', email: 'unrelated@example.com', role: 'Teacher' } } };
  });
  const { status, body } = await post('login', { ...loginInput, studentId: 'forged-number', authSource: 'system', appKey: 'untrusted-client-key' });
  assert.equal(status, 200);
  assert.equal(body.data.user._id, user._id);
  assert.equal(body.data.user.role, 'Captain');
  assert.equal(body.data.user.password, undefined);
  assert.equal(verifyToken(body.data.token).authSource, 'association');
});

test('old username or student-number plus local password login is disabled', async t => {
  const db = t.mock.method(User, 'findOne', () => { throw new Error('should not query'); });
  const remote = upstream(t);
  for (const username of ['local-name', '00202401', 'admin']) {
    assert.equal((await post('login', { username, password: '123456' })).status, 400);
  }
  assert.equal(db.mock.callCount(), 0);
  assert.equal(remote.mock.callCount(), 0);
});

test('email-code login normalizes email and keeps zero-prefixed student number', async t => {
  lookup(t, { studentId: '00202401' });
  t.mock.method(axios, 'post', async (_url, payload) => {
    assert.deepEqual(payload, { appKey: 'test-private-app-key', loginType: 'code', account: 'member@example.com', credential: '123456' });
    return { data: { code: 200, data: { userId: 42, userAccount: 'website-name', numberId: ' 00202401 ' } } };
  });
  assert.equal((await post('login', { loginType: 'code', account: ' Member@EXAMPLE.COM ', credential: ' 123456 ' })).status, 200);
});

test('unknown, missing or non-string upstream student numbers cannot select a local user', async t => {
  const db = t.mock.method(User, 'findOne', () => { throw new Error('should not query'); });
  const remote = upstream(t);
  for (const numberId of [undefined, '', '  ', 202401, { $ne: null }]) {
    remote.mock.mockImplementation(async () => ({ data: { code: 200, data: { numberId } } }));
    assert.equal((await post('login', loginInput)).status, 403);
  }
  assert.equal(db.mock.callCount(), 0);
});

test('website users who are not on the team cannot login or create local users', async t => {
  upstream(t);
  lookup(t, { studentId: '00202401' }, null);
  const create = t.mock.method(User, 'create', () => { throw new Error('must not create'); });
  const result = await post('login', loginInput);
  assert.equal(result.status, 403);
  assert.match(result.body.message, /尚未录入/);
  assert.equal(create.mock.callCount(), 0);
});

test('upstream authentication failures never fall back to local passwords', async t => {
  upstream(t, null, 500, '密码错误');
  const db = t.mock.method(User, 'findOne', () => { throw new Error('must not query'); });
  assert.equal((await post('login', loginInput)).status, 401);
  assert.equal(db.mock.callCount(), 0);
});

test('missing or invalid appKey gives configuration error without leaking the key', async t => {
  const remote = upstream(t, null, 500, 'Unauthorized: AppKey test-private-app-key 无效');
  const result = await post('login', loginInput);
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result.body).includes('test-private-app-key'));
  delete process.env.CWNUPAA_APP_KEY;
  assert.equal((await post('login', loginInput)).status, 503);
  assert.equal(remote.mock.callCount(), 1);
});

test('network errors and malformed upstream responses cannot leak credentials', async t => {
  const remote = t.mock.method(axios, 'post', async () => { throw new Error('test-private-app-key website password'); });
  let result = await post('login', loginInput);
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result.body).includes('website password'));
  remote.mock.mockImplementation(async () => ({ data: '<html>Login</html>' }));
  assert.equal((await post('login', loginInput)).status, 502);
});

test('invalid login types, object inputs and non-six-digit codes are rejected before upstream calls', async t => {
  const remote = upstream(t);
  for (const input of [
    { ...loginInput, loginType: 'local' }, { ...loginInput, account: { $ne: null } },
    { ...loginInput, credential: {} }, { loginType: 'code', account: 'not-email', credential: '123456' },
    { loginType: 'code', account: 'member@example.com', credential: '12345' },
  ]) assert.equal((await post('login', input)).status, 400);
  assert.equal(remote.mock.callCount(), 0);
});

test('admin can use the separate system endpoint without an upstream key', async t => {
  delete process.env.CWNUPAA_APP_KEY;
  const admin = { ...user, username: 'admin', password: await bcrypt.hash('admin-test-password', 4), role: 'Teacher' };
  lookup(t, { username: 'admin' }, admin, '+password');
  const remote = upstream(t);
  const result = await post('system-login', { username: 'admin', password: 'admin-test-password' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.user.password, undefined);
  assert.equal(verifyToken(result.body.data.token).authSource, 'system');
  assert.equal(remote.mock.callCount(), 0);
});

test('members, student-number aliases and object usernames cannot bypass via the system endpoint', async t => {
  const db = t.mock.method(User, 'findOne', () => { throw new Error('must not query'); });
  for (const username of ['local-name', '00202401', 'teacher']) {
    assert.equal((await post('system-login', { username, password: '123456' })).status, 403);
  }
  assert.equal((await post('system-login', { username: { $ne: '' }, password: '123456' })).status, 400);
  assert.equal(db.mock.callCount(), 0);
});

test('wrong admin password is rejected', async t => {
  lookup(t, { username: 'admin' }, { ...user, password: await bcrypt.hash('different-password', 4) }, '+password');
  assert.equal((await post('system-login', { username: 'admin', password: 'wrong-password' })).status, 401);
});

test('old sessions are rejected while newly authenticated sessions can access protected routes', async () => {
  const claims = { userId: 'id', username: 'local-name', role: 'Member' };
  const old = jwt.sign(claims, process.env.JWT_SECRET);
  assert.equal((await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${old}` } })).status, 401);
  const token = generateToken({ ...claims, authSource: 'association' });
  assert.equal((await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});

test('revoking a system account also revokes its existing sessions', () => {
  const token = generateToken({ userId: 'admin-id', username: 'admin', role: 'Teacher', authSource: 'system' });
  assert.ok(verifyToken(token));
  process.env.SYSTEM_LOGIN_USERNAMES = '';
  assert.equal(verifyToken(token), null);
});

test('send-code forwards normalized email and server key only', async t => {
  t.mock.method(axios, 'post', async (url, payload) => {
    assert.equal(url, 'https://www.cwnupaa.com/api/user/external/send-code');
    assert.deepEqual(payload, { email: 'member@example.com', appKey: 'test-private-app-key' });
    return { data: { code: 200, data: '验证码已发送' } };
  });
  assert.equal((await post('send-code', { email: ' Member@Example.com ', appKey: 'forged' })).status, 200);
  assert.equal((await post('send-code', { email: 'invalid' })).status, 400);
});
