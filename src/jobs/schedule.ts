// src/jobs/schedule.ts
import cron from 'node-cron';
import { refreshAllMembers } from '../services/crawler.service';
import { batchSettleLastMonth } from '../services/rating.service';
import { fetchAllUpcoming } from '../utils/crawlers/upcoming';
import Upcoming from '../models/upcoming.model';

// 初始化定时任务
export const initScheduledJobs = () => {
  console.log('[Job] 定时任务系统已启动...');

  // 任务 1: 每日凌晨 03:00 自动爬取全队刷题数
  // 目的：更新 User.problemNumber 和 PracticeMonthStats.problemCount
  cron.schedule('0 3 * * *', async () => {
    console.log('[Job] ⏰ 触发每日自动爬虫...');
    try {
      const result = await refreshAllMembers();
      console.log(`[Job] 每日爬虫结束: 成功 ${result.successCount}, 失败 ${result.failCount}`);
    } catch (e) {
      console.error('[Job] 每日爬虫异常:', e);
    }
  });

  // 任务 2: 每月 1 号凌晨 04:00 结算上月 Rating
  // 目的：计算系数 K，计算 R_problem，更新 User.rating
  cron.schedule('0 4 1 * *', async () => {
    console.log('[Job] 📅 触发月度 Rating 结算...');
    try {
      const count = await batchSettleLastMonth();
      console.log(`[Job] 月度结算完成，共处理 ${count} 人`);
    } catch (e) {
      console.error('[Job] 月度结算异常:', e);
    }
  });

  // 每 2 小时抓取一次
  cron.schedule('0 */2 * * *', async () => {
    console.log('[Crawler] 开始抓取近期赛事...');
    try {
      const contests = await fetchAllUpcoming();
      if (contests.length > 0) {
        // 1. 删除所有旧的爬虫数据 (保留 Manual 数据!)
        await Upcoming.deleteMany({ type: 'Crawled' });
        
        // 2. 插入新数据
        const docs = contests.map(c => ({ ...c, type: 'Crawled' }));
        await Upcoming.insertMany(docs);
        
        console.log(`[Crawler] 赛事更新完成: 抓取到 ${docs.length} 场`);
      }
    } catch (e) {
      console.error('[Crawler] 任务失败:', e);
    }
  });
};