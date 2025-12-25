import { Request, Response } from 'express';
import { crawlNowCoder } from '../utils/crawlers/nowcoder';
import { getAtCoder, getCodeForces, getLuogu, getNowCoder, syncUserSubmissions } from '../services/submissions.service';
import { fail, success } from '../utils/response';

// 1. 获取AtCoder提交数据的同步接口
export const syncAtCoder = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId
    const username = req.params.username as string;
    const crawlResult = await getAtCoder(username, userId); 
    success(res, crawlResult, `同步完成,新增 ${crawlResult?.new} 条 AC 数据。`);
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
    const crawlResult = await getCodeForces(username, userId); 
    success(res, crawlResult, `同步完成,新增 ${crawlResult?.new} 条 AC 数据。`);
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
    const crawlResult = await getLuogu(username, userId, client_id); 
    success(res, crawlResult, `同步完成,新增 ${crawlResult?.new} 条 AC 数据。`);
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
    const crawlResult = await getNowCoder(username, userId); 
    success(res, crawlResult, `同步完成,新增 ${crawlResult?.new} 条 AC 数据。`);
  } catch (e: any) {
    console.log('sync cf faild', e);
    fail(res, `同步失败: ${e.message}`, 500, 500)
  }
}

// 5. 同步所有OJ
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