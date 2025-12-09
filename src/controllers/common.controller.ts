// src/controllers/common.controller.ts
import { Request, Response } from 'express';
import { success, fail } from '../utils/response';

export const uploadFile = (req: Request, res: Response) => {
  if (!req.file) {
    return fail(res, '请选择文件', 400);
  }

  const fileUrl = `/uploads/common/${req.file.filename}`;

  success(res, { url: fileUrl }, '上传成功');
};