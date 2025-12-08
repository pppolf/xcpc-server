import { TokenPayload } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload; // 给 Request 添加 user 属性
    }
  }
}