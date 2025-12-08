import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { fail } from '../utils/response';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // 1. 获取 Authorization 头
  // 前端发来的格式通常是: "Bearer <token>"
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail(res, '未登录或Token格式错误', 401);
  }

  // 2. 提取 Token 字符串
  const token = authHeader.split(' ')[1];

  // 3. 验证 Token
  const decoded = verifyToken(token);

  if (!decoded) {
    return fail(res, '登录已过期，请重新登录', 401);
  }

  // 4. 将用户信息挂载到 req 上，方便后续 Controller 使用
  req.user = decoded;

  // 5. 放行
  next();
};

// 可选：角色校验中间件 (只有某些角色能访问)
export const roleMiddleware = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return fail(res, '权限不足，拒绝访问', 403);
    }
    next();
  };
};