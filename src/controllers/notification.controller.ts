import { Request, Response } from 'express';
import Notification from '../models/notification.model';
import { success, fail } from '../utils/response';

// 获取我的消息列表
export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId || (req as any).user._id;
    // 按时间倒序
    const list = await Notification.find({ userId }).sort({ createdAt: -1 });
    
    // 计算未读数量
    const unreadCount = await Notification.countDocuments({ userId, isRead: false });
    
    success(res, { list, unreadCount });
  } catch (error) {
    fail(res, '获取消息失败');
  }
};

// 标记单条已读
export const readNotification = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndUpdate(id, { isRead: true });
    success(res, null);
  } catch (error) {
    fail(res, '操作失败');
  }
};

// 一键全部已读
export const readAllNotifications = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId || (req as any).user._id;
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
    success(res, null);
  } catch (error) {
    fail(res, '操作失败');
  }
};