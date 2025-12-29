export class AtCoderCookieExpiredError extends Error {
  constructor(message: string = 'AtCoder Cookie 已过期或无效，请联系管理员更新') {
    super(message);
    this.name = 'AtCoderCookieExpiredError';
  }
}