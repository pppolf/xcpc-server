import { refreshAllMembers, refreshUserSolvedStats } from '../services/crawler.service';
import { success, fail } from '../utils/response';
import { Request, Response } from 'express';
import User from '../models/user.model';
import Notification from '../models/notification.model';

// 刷新个人做题情况
export const refreshUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) return fail(res, 'UserId 不能为空');
    const result = await refreshUserSolvedStats(userId, 'MANUAL');
    
    const msg = result.increment > 0 
      ? `刷新成功，新增 ${result.increment} 题` 
      : '刷新成功，暂无新题';
    success(res, result, msg);
  } catch (error: any) {
    console.error(error);
    fail(res, error.message || '刷新失败 (可能是爬虫超时或账号错误)', 500);
  }
};

// 批量刷新做题情况
export const refreshAll = async (req: Request, res: Response) => {
  try {
    // 这个操作耗时较长，建议前端设置较长的 timeout
    const userId = req.user?.userId
    const result = await refreshAllMembers();
    // ✅ 成功通知
    await Notification.create({
      userId,
      title: '同步完成',
      content: `全队刷新已完成，请刷新页面查看最新数据。成功 ${result.successCount} 人，失败 ${result.failCount} 人`,
      type: 'success',
      isRead: false
    });
    success(res, result, `批量刷新完成：成功 ${result.successCount} 人，失败 ${result.failCount} 人`);
  } catch (error: any) {
    const userId = req.user?.userId
    await Notification.create({
      userId,
      title: '同步失败',
      content: `批量刷新时遇到问题: ${error.message || '未知错误'}，请稍后再试。`,
      type: 'error',
      isRead: false
    });
    fail(res, error.message || '批量刷新服务异常', 500, 500);
  }
};

// 获取需要刷新的用户
export const getRefreshTargets = async (req: Request, res: Response) => {
  try {
    const users = await User.find(
      { role: { $ne: 'Teacher' } }, 
      { _id: 1, realName: 1, studentId: 1 } // 只查这几个字段，速度快
    );
    success(res, users);
  } catch (error: any) {
    fail(res, error.message || '获取目标失败', 500);
  }
};