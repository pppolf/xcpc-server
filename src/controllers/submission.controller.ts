import { Request, Response } from 'express';
import { getAtCoder, getCodeForces, getLuogu, getNowCoder, syncUserSubmissions } from '../services/submissions.service';
import { fail, success } from '../utils/response';
import Notification from '../models/notification.model';
import User from '../models/user.model';
import { syncSchoolOjTracker } from '../services/school-oj-tracker.service';
import { schoolOjUid } from '../utils/crawlers/cwnuoj';

/**
 * 通用后台任务执行器
 * @param userId 用户ID
 * @param platform 平台名称 (用于显示)
 * @param taskFn 具体的异步爬虫函数
 */
const runBackgroundTask = (userId: string, platform: string, taskFn: () => Promise<any>) => {
  // 🟢 关键：不使用 await，让它在后台跑
  taskFn()
    .then(async () => {
      const user = await User.findById(userId).select('-password');
      console.log(`[Sync] ${platform} 同步成功 - User: ${user?.realName}, uid: ${userId}`);
      // ✅ 成功通知
      await Notification.create({
        userId,
        title: '同步完成',
        content: `您的 ${platform} 数据已成功同步，请刷新统计页面查看最新数据。`,
        type: 'success',
        isRead: false
      });
    })
    .catch(async (err) => {
      const user = await User.findById(userId).select('-password');
      console.error(`[Sync] ${platform} 同步失败 - User: ${user?.realName}, uid: ${userId}`, err);
      // ❌ 失败通知
      await Notification.create({
        userId,
        title: '同步失败',
        content: `同步 ${platform} 时遇到问题: ${err.message || '未知错误'}，请稍后再试。`,
        type: 'error',
        isRead: false
      });
    });
};

export const syncCWNUOJ = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  try {
    const user = await User.findById(userId).select('ojInfo.cwnuoj');
    if (!user) return fail(res, '用户不存在', 404, 404);
    schoolOjUid(user.ojInfo?.cwnuoj);
  } catch (error) {
    return fail(res, error instanceof Error ? error.message : '学校 OJ 账号读取失败', 400, 400);
  }
  success(res, { message: '学校 OJ 同步任务已启动，结果将通过消息通知您。' });
  runBackgroundTask(userId, '学校 OJ', () => syncSchoolOjTracker(userId));
};

// 1. 获取AtCoder提交数据的同步接口
export const syncAtCoder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId
    const username = req.params.username as string;
    success(res, { message: 'AtCoder同步任务已启动，结果将通过消息通知您。' });
    runBackgroundTask(userId, 'AtCoder', async () => {
      await getAtCoder(username, userId); 
    });
  } catch (e: any) {
    console.log('sync cf faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
};

// 2. 获取CodeForces提交数据的同步接口
export const syncCodeForces = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId
    const username = req.params.username;
    success(res, { message: 'CodeForces同步任务已启动，结果将通过消息通知您。' });
    runBackgroundTask(userId, 'CodeForces', async () => {
      await getCodeForces(username, userId); 
    });
  } catch (e: any) {
    console.log('sync cf faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
};

// 3. 获取Luogu提交数据的同步接口
export const syncLuogu = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId
    const username = req.params.username as string;
    const client_id = req.query.client_id as string;
    success(res, { message: '洛谷同步任务已启动，结果将通过消息通知您。' });
    runBackgroundTask(userId, '洛谷', async () => {
      await getLuogu(username, userId, client_id);
    });
  } catch (e: any) {
    console.log('sync cf faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
};

// 4. 获取NowCoder提交数据的同步接口
export const syncNowCoder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId
    const username = req.params.userId;
    success(res, { message: '牛客同步任务已启动，结果将通过消息通知您。' });
    runBackgroundTask(userId, '牛客', async () => {
      await getNowCoder(username, userId); 
    });
  } catch (e: any) {
    console.log('sync cf faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
}

// 5. 同步所有OJ - 废弃
export const syncData = async (req: Request, res: Response) => {
  try {
    const targetUserId = req.query.userId || req.user?.userId;
    const client_id = req.params.client_id as string;
    const result = await syncUserSubmissions(targetUserId as string, client_id)
    success(res, result, `同步完成,新增 ${result?.new} 条 AC 数据。`);
  } catch (e: any) {
    console.log('sync faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
}
