import { Request, Response } from 'express';
import Upcoming from '../models/upcoming.model';
import { success, fail } from '../utils/response';
import { fetchAllUpcoming } from '../utils/crawlers/upcoming';

// 获取列表 (用于管理页)
export const getManualContests = async (req: Request, res: Response) => {
  const list = await Upcoming.find({ type: 'Manual' }).sort({ startTime: 1 });
  success(res, list);
};

// 添加手动赛事
export const addManualContest = async (req: Request, res: Response) => {
  try {
    const { name, platform, link, startTime } = req.body;
    await Upcoming.create({
      name, platform, link, startTime,
      type: 'Manual'
    });
    success(res, null, '添加成功');
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 删除手动赛事
export const deleteManualContest = async (req: Request, res: Response) => {
  await Upcoming.findByIdAndDelete(req.params.id);
  success(res, null, '删除成功');
};

export const refreshContests = async (req: Request, res: Response) => {
  try {
    console.log('[Manual Trigger] 开始手动更新近期赛事...');
    
    // 1. 执行爬取
    const contests = await fetchAllUpcoming();
    
    if (contests.length > 0) {
      // 2. 删除旧的爬虫数据 (保留 Manual)
      await Upcoming.deleteMany({ type: 'Crawled' });
      
      // 3. 插入新数据
      const docs = contests.map(c => ({ ...c, type: 'Crawled' }));
      await Upcoming.insertMany(docs);
      
      success(res, { count: docs.length }, `更新成功，抓取到 ${docs.length} 场赛事`);
    } else {
      success(res, { count: 0 }, '未抓取到新数据，请稍后重试');
    }
  } catch (e: any) {
    console.error('[Manual Trigger] 更新失败:', e);
    fail(res, e.message || '更新失败');
  }
};