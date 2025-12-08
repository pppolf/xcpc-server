import jwt, { SignOptions } from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'default_secret_key';
// 注意：这里环境变量取出来是 string，但 jwt 有时需要 number 或特定字符串格式
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// 定义 Token 载荷的接口
export interface TokenPayload {
  userId: string;
  username: string;
  role: string;
}

// 1. 生成 Token
export const generateToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    expiresIn: EXPIRES_IN as any
  };
  
  return jwt.sign(payload, SECRET_KEY, options);
};

// 2. 验证 Token
export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, SECRET_KEY) as TokenPayload;
  } catch (error) {
    return null;
  }
};