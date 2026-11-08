// src/jobs/schedule.ts
import cron from "node-cron";
import { refreshAllMembers } from "../services/crawler.service";
import { batchSettleLastMonth } from "../services/rating.service";
import { refreshNowCoderDifficultyCache } from "../utils/crawlers/nowcoder";
import { syncAllSchoolOjTrackers } from '../services/school-oj-tracker.service';

// 初始化定时任务
export const initScheduledJobs = () => {
  console.log("[Job] 定时任务系统已启动...");
  cron.schedule('0 0 * * *', () => {
    void syncAllSchoolOjTrackers().catch(error => console.error('[CWNUOJ Tracker] 自动同步任务失败', error));
  }, { timezone: 'Asia/Shanghai', noOverlap: true });
  // Populate school-OJ detail records after deployment; fresh users are skipped.
  const initialSchoolSync = setTimeout(() => {
    void syncAllSchoolOjTrackers(true).catch(error => console.error('[CWNUOJ Tracker] 首次同步任务失败', error));
  }, 15000);
  initialSchoolSync.unref();

  // 任务 1: 每日凌晨 03:00 自动爬取全队刷题数
  // 目的：更新 User.problemNumber 和 PracticeMonthStats.problemCount
  cron.schedule("0 3 * * *", async () => {
    console.log("[Job] ⏰ 触发每日自动爬虫...");
    try {
      const result = await refreshAllMembers();
      console.log(
        `[Job] 每日爬虫结束: 成功 ${result.successCount}, 失败 ${result.failCount}`,
      );
    } catch (e) {
      console.error("[Job] 每日爬虫异常:", e);
    }
  });

  // 任务 2: 每月 1 号凌晨 04:00 结算上月 Rating
  // 目的：计算系数 K，计算 R_problem，更新 User.rating
  cron.schedule("0 4 1 * *", async () => {
    console.log("[Job] 📅 触发月度 Rating 结算...");
    try {
      const count = await batchSettleLastMonth();
      console.log(`[Job] 月度结算完成，共处理 ${count} 人`);
    } catch (e) {
      console.error("[Job] 月度结算异常:", e);
    }
  });

  // 任务 4: 每日凌晨 05:00 维护牛客难度缓存
  // 目的：尝试修复缓存中未获取到难度的题目，保持本地 JSON 数据新鲜
  cron.schedule("0 5 * * *", async () => {
    console.log("[Job] 🛠️ 开始维护牛客题目难度缓存...");
    try {
      await refreshNowCoderDifficultyCache();
    } catch (e) {
      console.error("[Job] 难度缓存维护异常:", e);
    }
  });
};
