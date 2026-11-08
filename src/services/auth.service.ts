import axios from 'axios';
import bcrypt from 'bcryptjs';
import User from '../models/user.model';
import { getIntegrationKey } from './integration-keys.service';

const ASSOCIATION_API = 'https://www.cwnupaa.com/api/user/external';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthenticationError extends Error {
  constructor(message: string, public status: number = 401) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

// Only these explicitly configured accounts retain local password authentication.
// An empty value disables system login altogether.
export const isSystemAccount = (username: string): boolean =>
  (process.env.SYSTEM_LOGIN_USERNAMES ?? 'admin')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(username);

const requireText = (value: unknown, message: string, maxLength = 254): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AuthenticationError(message, 400);
  }
  return value.trim();
};

const requireEmail = (value: unknown): string => {
  const email = requireText(value, '请输入正确的官网绑定邮箱').toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new AuthenticationError('请输入正确的官网绑定邮箱', 400);
  }
  return email;
};

const associationRequest = async (path: '/login' | '/send-code', payload: Record<string, string>) => {
  const appKey = await getIntegrationKey('CWNUPAA_APP_KEY');
  if (!appKey) {
    throw new AuthenticationError('协会官网登录尚未配置，请联系管理员', 503);
  }

  let response;
  try {
    response = await axios.post(`${ASSOCIATION_API}${path}`, { ...payload, appKey }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
      maxRedirects: 0,
    });
  } catch (error) {
    // Never expose Axios errors: they include the appKey and login credentials.
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      throw new AuthenticationError('操作过于频繁，请稍后再试', 429);
    }
    throw new AuthenticationError('协会官网暂时无法连接，请稍后重试', 502);
  }

  const body = response.data;
  if (!body || typeof body !== 'object' || typeof body.code !== 'number') {
    throw new AuthenticationError('协会官网返回异常，请稍后重试', 502);
  }
  if (body.code !== 200) {
    const message = typeof body.msg === 'string' ? body.msg : '';
    if (/appkey|api\s*key|unauthorized|外部登录权限/i.test(message) || message.includes(appKey)) {
      throw new AuthenticationError('协会官网登录配置不可用，请联系管理员', 503);
    }
    throw new AuthenticationError(message.slice(0, 200) || '协会官网认证失败', path === '/login' ? 401 : 400);
  }
  return body.data;
};

export const loginWithAssociation = async (input: Record<string, unknown>) => {
  const { loginType } = input;
  if (loginType !== 'password' && loginType !== 'code') {
    throw new AuthenticationError('请选择官网密码登录或邮箱验证码登录', 400);
  }
  const account = loginType === 'code'
    ? requireEmail(input.account)
    : requireText(input.account, '请输入协会官网账号或邮箱');
  // Preserve whitespace in passwords, which is part of the credential.
  if (typeof input.credential !== 'string' || !input.credential || input.credential.length > 1024) {
    throw new AuthenticationError(loginType === 'code' ? '请输入六位邮箱验证码' : '请输入官网密码', 400);
  }
  const credential = loginType === 'code' ? input.credential.trim() : input.credential;
  if (loginType === 'code' && !/^\d{6}$/.test(credential)) {
    throw new AuthenticationError('请输入六位邮箱验证码', 400);
  }

  const identity = await associationRequest('/login', { loginType, account, credential });
  if (!identity || typeof identity.numberId !== 'string' || !identity.numberId.trim()) {
    throw new AuthenticationError('官网账号未绑定学号，请先到协会官网完善学号', 403);
  }

  // Identity must come exclusively from the authenticated upstream response.
  // Never match local usernames, names or email addresses, or create new members.
  const user = await User.findOne({ studentId: identity.numberId.trim() }).select('-password');
  if (!user) {
    throw new AuthenticationError('该学号尚未录入集训队系统，请联系管理员', 403);
  }
  if (isSystemAccount(user.username)) {
    throw new AuthenticationError('系统账号请使用右下角的系统账号登录入口', 403);
  }
  const upstreamId = typeof identity.userId === 'number' && Number.isSafeInteger(identity.userId) && identity.userId > 0
    ? String(identity.userId)
    : typeof identity.userId === 'string' && /^[1-9]\d{0,18}$/.test(identity.userId) ? identity.userId : '';
  if (!upstreamId || typeof identity.userAccount !== 'string' || !identity.userAccount.trim()) {
    throw new AuthenticationError('协会官网未返回完整账号身份，请联系管理员', 502);
  }
  const linked = await User.findOneAndUpdate(
    { _id: user._id, studentId: identity.numberId.trim() },
    { $set: { associationIdentity: {
      userId: upstreamId,
      account: identity.userAccount.trim(),
      studentId: identity.numberId.trim(),
      verifiedAt: new Date(),
    } } },
    { new: true, runValidators: true },
  ).select('-password');
  if (!linked) throw new AuthenticationError('队员资料已变化，请重新登录', 403);
  const result = linked.toObject();
  delete result.password;
  return result;
};

export const sendAssociationCode = async (email: unknown) => {
  await associationRequest('/send-code', { email: requireEmail(email) });
};

export const loginWithSystemAccount = async (input: Record<string, unknown>) => {
  const username = requireText(input.username, '请输入系统账号');
  if (typeof input.password !== 'string' || !input.password || input.password.length > 1024) {
    throw new AuthenticationError('请输入系统账号密码', 400);
  }
  if (!isSystemAccount(username)) {
    throw new AuthenticationError('该账号不支持系统账号登录，请使用协会官网账号', 403);
  }

  const user = await User.findOne({ username }).select('+password');
  if (!user?.password || !await bcrypt.compare(input.password, user.password)) {
    throw new AuthenticationError('系统账号或密码错误');
  }
  const result = user.toObject();
  delete result.password;
  return result;
};
