// 后端统一返回工具
import { Response } from 'express';

export const success = (res: Response, data: any, message: string = '操作成功') => {
  res.status(200).json({
    success: true,
    code: 200,
    message,
    data
  });
};

export const fail = (res: Response, message: string = '操作失败', code: number = 400, status: number = 200) => {
  // status 是 HTTP 状态码，code 是业务状态码
  res.status(status).json({
    success: false,
    code,
    message,
    data: null
  });
};