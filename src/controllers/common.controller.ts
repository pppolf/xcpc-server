// src/controllers/common.controller.ts
import { Request, Response } from 'express';
import { success, fail } from '../utils/response';

export const uploadFile = (req: Request, res: Response) => {
  if (!req.file) {
    return fail(res, '请选择文件', 400);
  }

  // 拼接可访问的 URL
  // 假设服务器地址是 http://localhost:3000
  // 返回路径如: /uploads/17000000-123.png
  const fileUrl = `/uploads/${req.file.filename}`;

  success(res, { url: fileUrl }, '上传成功');
};