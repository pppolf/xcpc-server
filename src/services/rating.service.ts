// src/services/rating.service.ts
import ContestRecord from '../models/contest-record.model';
import PracticeMonthStats from '../models/practice-stats.model';
import SeasonRating from '../models/season-rating.model';
import User from '../models/user.model';
import { RATING_CONFIG } from '../config/rating.config';
import { getSeasonDiff } from '../utils/season.helper';
import MonthlySnapshot from '../models/monthly-snapshot.model';
import { getCurrentSeason } from './config.service';
import { fetchOjData } from './crawler.service';

/**
 * 获取上个月的刷题统计数据
 */
const getLastMonthStats = async (userId: string, currentYear: number, currentMonth: number) => {
  // 计算上个月的年份和月份
  let lastYear = currentYear;
  let lastMonth = currentMonth - 1;
  if (lastMonth === 0) {
    lastMonth = 12;
    lastYear = currentYear - 1;
  }

  return await PracticeMonthStats.findOne({
    userId,
    year: lastYear,
    month: lastMonth
  });
};

/**
 * 🚀 核心逻辑：每月1号的自动结算任务
 * 执行时间：例如 凌晨
 * 目标：结算 本月 的刷题分
 */
export const batchSettleLastMonth = async () => {
  const now = new Date();
  const currentSeason = getCurrentSeason();
  
  // 1. 确定时间窗口
  // "本月" (用于存新的快照)
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1; 

  // "上月" (用于结算)
  let lastYear = thisYear;
  let lastMonth = thisMonth - 1;
  if (lastMonth === 0) {
    lastMonth = 12;
    lastYear -= 1;
  }

  console.log(`[Job] 开始结算: ${lastYear}-${lastMonth} -> ${thisYear}-${thisMonth}`);

  const users = await User.find({ role: { $ne: 'Teacher' } });
  let count = 0;

  for (const user of users) {
    const oldStats = user.ojStats || { codeforces: 0, atcoder: 0, nowcoder: 0, luogu: 0, cwnuoj: 0 };
    try {
      // 2. 现场爬取该用户“此时此刻”的总题数 (作为 10月1日 快照)
      const crawlerRes = await fetchOjData(user.ojInfo, oldStats); 
      const currentTotal = crawlerRes.total;

      // 3. 寻找 “上个月初” 的快照
      const lastSnapshot = await MonthlySnapshot.findOne({
        userId: user._id,
        year: lastYear,
        month: lastMonth
      });

      // 4. 计算增量 (差分)
      // 如果有上月快照，增量 = 现在(160) - 上月快照(100) = 60
      // 如果没有上月快照(新入队)，增量 = 现在(160) - 0 = 160
      const startTotal = lastSnapshot ? lastSnapshot.totalSolved : 0;
      const increment = Math.max(0, currentTotal - startTotal);

      console.log(`用户 ${user.realName}: 月初(${startTotal}) -> 月末(${currentTotal}) = 新增 ${increment}`);

      // 5. 存入/更新 的统计表 (PracticeMonthStats)
      // 这才是真正用来算 Rating 的数据
      await PracticeMonthStats.findOneAndUpdate(
        { userId: user._id, year: lastYear, month: lastMonth },
        {
          $set: {
            problemCount: increment, // 覆盖掉之前可能不准的累加值
            season: currentSeason,
            isSettled: true // 标记已结算
          }
        },
        { upsert: true, new: true }
      );

      // 6. 触发 Rating 计算 (算分、算系数)
      // 这里调用之前的逻辑，它会读取我们刚刚更新的 problemCount
      await settleMonthlyPractice(user._id.toString(), lastYear, lastMonth, increment);
      await updateUserTotalRating(user._id.toString());

      // 7. 保存“本月初” 的快照，给下个月用
      await MonthlySnapshot.findOneAndUpdate(
        { userId: user._id, year: thisYear, month: thisMonth },
        { 
          season: currentSeason,
          totalSolved: currentTotal 
        },
        { upsert: true }
      );
      
      // 8. 顺手更新 User 表的总缓存
      user.problemNumber = currentTotal;
      await user.save();

      count++;
      // 稍微慢一点，防止被 OJ 封
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.error(`结算用户 ${user.realName} 失败:`, error);
    }
  }
  
  return count;
};

// --- 2. 业务逻辑 ---

// 计算单场比赛得分
export const calculateRawScore = (
  type: string,       // 大类: XCPC_REGIONAL, LANQIAO
  awardLevel: string | null, // 等级: NAT_1, null (注意类型允许null)
  season: string,     // 赛季: 2022-2023
  N: number = 0,      // 总人数
  rk: number = 0      // 排名
): number => {
  const { BASE_SCORE, WEIGHTS, AWARD_DECAY, AWARD_WEIGHTS } = RATING_CONFIG.CONTEST;
  const currentSeason = getCurrentSeason();
  
  // === A. 奖项认定系列 ===
  // 组合 key，例如 "LANQIAO_NAT_1"
  const awardKey = awardLevel ? `${type}_${awardLevel}` : '';
  
  if (awardKey in AWARD_WEIGHTS) {
    const base = BASE_SCORE.AWARD; // 100
    const weight = (AWARD_WEIGHTS as any)[awardKey]; // 对应权重
    
    // 计算衰减
    const diff = getSeasonDiff(currentSeason, season);
    // 越界保护
    const decayIndex = Math.min(diff, AWARD_DECAY.length - 1);
    // 如果超过4个赛季，衰减系数取数组最后一个或0
    const decay = diff < 4 ? AWARD_DECAY[decayIndex] : 0;
    
    return parseFloat((base * weight * decay).toFixed(2));
  }

  // 计算衰减
  const diff = getSeasonDiff(currentSeason, season);
  // 越界保护
  const decayIndex = Math.min(diff, AWARD_DECAY.length - 1);
  // 如果超过4个赛季，衰减系数取数组最后一个或0
  const decay = diff < 4 ? AWARD_DECAY[decayIndex] : 0;

  // 获取基准分
  let base = BASE_SCORE.XCPC;
  if (type.includes('CAMP')) base = BASE_SCORE.CAMP;

  // 获取权重
  const weight = (WEIGHTS as any)[type] || 0;

  // 基础公式: B * (N - rk + 1) / N * W
  if (N === 0) return 0;

  // 如果排名大于总人数，说明数据有问题，直接返回 0 或者抛错，防止出现负分炸毁系统
  if (rk > N) {
    console.warn(`[Rating Warning] Rank(${rk}) > Total(${N}), returning 0.`);
    return 0;
  }

  
  const score = base * ((N - rk + 1) / N) * weight * decay;
  
  // 再次确保不返回负数
  return Math.max(0, parseFloat(score.toFixed(2)));
};

// 计算用户本赛季总比赛分 (取 Top 10)
export const calculateContestRating = async (userId: string) => {
  const { CONTEST } = RATING_CONFIG;

  const allRecords = await ContestRecord.find({ userId });
  const validScores: number[] = [];

  for (const record of allRecords) {
    const currentScore = calculateRawScore(
      record.type,
      record.awardLevel,
      record.season,
      record.totalParticipants,
      record.rank
    );

    if (currentScore > 0) {
      validScores.push(currentScore);
    }
  }

  // 降序排列
  validScores.sort((a, b) => b - a);

  // 取前 10
  const top10 = validScores.slice(0, CONTEST.TOP_N);

  // 求和
  const total = top10.reduce((sum, s) => sum + s, 0);
  
  return parseFloat(total.toFixed(2));
};

// 结算某个月的刷题分 (并保存到数据库)
export const settleMonthlyPractice = async (userId: string, year: number, month: number, problemCount: number) => {
  const { MONTH_THRESHOLD, SCORE_PER_PROBLEM, K_INCREMENT, K_DECREMENT, K_MAX, K_MIN } = RATING_CONFIG.PRACTICE;
  
  // 1. 获取上个月的系数
  const lastMonthStats = await getLastMonthStats(userId, year, month); 
  // 如果上个月没记录，且是入队第一个月，给 1.0；否则根据逻辑可能需要继承
  let k = lastMonthStats ? lastMonthStats.activeCoefficient : 1.0;
  
  // 2. 更新系数逻辑
  if (problemCount >= MONTH_THRESHOLD) {
    // 达标：奖励 +0.1
    k = Math.min(K_MAX, k + K_INCREMENT);
  } else {
    // 不达标：惩罚 -0.2
    k = Math.max(K_MIN, k - K_DECREMENT);
  }
  
  // 保留两位小数，防止浮点数精度问题 (如 0.8 - 0.2 = 0.60000001)
  k = parseFloat(k.toFixed(2));

  // 3. 计算当月得分
  // min(60, P) * 0.5 * K
  const effectiveCount = Math.min(MONTH_THRESHOLD, problemCount);
  const monthScore = effectiveCount * SCORE_PER_PROBLEM * k;
  
  // 4. [修复] 保存/更新数据库
  // 使用 findOneAndUpdate (Upsert) 确保幂等性
  await PracticeMonthStats.findOneAndUpdate(
    { userId, year, month },
    {
      $set: {
        season: getCurrentSeason(),
        problemCount,
        activeCoefficient: k,
        monthScore: parseFloat(monthScore.toFixed(2)),
        isSettled: true
      }
    },
    { upsert: true, new: true }
  );

  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        'ratingInfo.activeCoefficient': k
      }
    },
    { new: true }
  )
  
  return { k, monthScore };
};

// 计算本赛季总刷题分 (求和所有月，上限 500)
export const calculatePracticeRating = async (userId: string) => {
  const stats = await PracticeMonthStats.find({ 
    userId, 
    season: getCurrentSeason()
  });
  
  const total = stats.reduce((sum, s) => sum + s.monthScore, 0);
  
  return Math.min(RATING_CONFIG.PRACTICE.SEASON_MAX, parseFloat(total.toFixed(2)));
};

/**
 * 计算历史继承分
 * @param userId 用户ID
 * @param baseSeason (可选) 基准赛季。如果不传，则使用系统当前赛季。
 * 在赛季切换时，必须传入“新赛季”，这样“旧赛季”才会被算作历史。
 */
export const calculateLegacyRating = async (userId: string, baseSeason?: string) => {
  const { FACTOR } = RATING_CONFIG.LEGACY;
  
  // 1. 确定基准赛季
  // 如果是在 setSeason 流程里，baseSeason 就是 "2025-2026"
  // 如果是日常更新，baseSeason 为空，取系统当前的 "2024-2025"
  const currentSeason: string = baseSeason || getCurrentSeason(); 
  
  // 2. 查找历史记录
  // 逻辑：只要不是基准赛季的，都算历史。
  // 切换时：基准是新赛季，所以旧赛季(刚归档) != 新赛季，会被查出来 -> 正确！
  const history = await SeasonRating.find({ 
    userId, 
    season: { $ne: currentSeason } 
  });
  
  let totalLegacy = 0;
  
  for (const rec of history) {
    // 计算时间差：新赛季 vs 历史赛季
    const k = getSeasonDiff(currentSeason, rec.season);
    // Rating * 0.6^k
    totalLegacy += rec.finalRating * Math.pow(FACTOR, k);
  }
  
  return parseFloat(totalLegacy.toFixed(2));
};

// 更新用户总分 (主入口)
export const updateUserTotalRating = async (userId: string) => {
  // 并行计算三部分分数
  const [rContest, rProblem, rLegacy] = await Promise.all([
    calculateContestRating(userId),
    calculatePracticeRating(userId),
    calculateLegacyRating(userId)
  ]);
  
  const total = rContest + rProblem + rLegacy;
  const finalRating = parseFloat(total.toFixed(2));
  
  // 更新 User 表 (注意字段名统一)
  // 假设你在 User Schema 中定义的是 ratingInfo
  await User.findByIdAndUpdate(userId, {
    rating: finalRating, 
    "ratingInfo.contest": rContest,
    "ratingInfo.problem": rProblem,
    "ratingInfo.legacy": rLegacy
  });

  return finalRating;
};

/**
 * 获取指定年月的全员快照
 * @param year 年份 (如 2023)
 * @param month 月份 (1-12)
 */
export const getMonthSnapshot = async (year: number, month: number) => {
  // 1. 直接查询该年月的快照表
  const snapshots = await MonthlySnapshot.find({
    year: year,
    month: month
  })
  // 2. 关联查询 User 表，把 userId 变成具体的 { realName, studentId ... }
  .populate({
    path: 'userId',
    select: 'realName studentId college role trainingTeam', // 只取需要的字段
    // 3. 可选：过滤掉老师 (虽然快照表理论上不存老师，但加一层保险)
    match: { role: { $ne: 'Teacher' } }
  })
  .lean(); // 转为普通 JS 对象，速度更快

  // 4. (可选) 过滤掉关联不到用户的脏数据（比如用户被删了，但快照还在）
  return snapshots.filter(s => s.userId !== null);
};

/**
 * 🚨 赛季归档核心逻辑
 * @param oldSeason 即将结束的旧赛季
 * @param newSeason 即将开启的新赛季 (用于计算继承分)
 */
export const archiveAndResetSeason = async (oldSeason: string, newSeason: string) => {
  console.log(`[Season] 开始归档: ${oldSeason} -> ${newSeason}`);

  const users = await User.find({ role: { $ne: 'Teacher' } }).sort({ rating: -1 });
  let count = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const rank = i + 1;

    try {
      // 1. 【归档】将当前 User 表里的数据存入 SeasonRating
      // 这里的 ratingInfo.contest 等字段存的是旧赛季的最终成绩
      await SeasonRating.findOneAndUpdate(
        { userId: user._id, season: oldSeason },
        {
          $set: {
            finalRating: user.rating,
            contestScore: user.ratingInfo?.contest || 0,
            practiceScore: user.ratingInfo?.problem || 0,
            trainingTeam: user.trainingTeam || 'Second',
            rank: rank
          }
        },
        { upsert: true, new: true }
      );

      // 2. 【预计算】在新赛季开始那一刻，该用户的 Rating 应该是多少？
      // 新赛季初始分 = 0(比赛) + 0(刷题) + 历史继承分(基于新赛季计算)
      // 🔴 关键：传入 newSeason，这样 calculateLegacyRating 会把 oldSeason 当作历史
      const newLegacyScore = await calculateLegacyRating(user._id.toString(), newSeason);
      
      // 3. 【重置】强制更新 User 表 (原子操作)
      // 我们显式指定所有字段，不给 Mongoose 忽略的机会
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            // 总分 = 继承分
            rating: newLegacyScore,
            
            // 必须显式更新嵌套字段
            "ratingInfo.contest": 0,
            "ratingInfo.problem": 0,
            "ratingInfo.legacy": newLegacyScore,
            "ratingInfo.activeCoefficient": 1.0 // 重置活跃系数
          }
        }
      );
      
      // 注意：这里不要调用 updateUserTotalRating(user._id)，因为此时全局配置还没变，
      // 调用它可能会导致它又用旧赛季配置算了一遍，覆盖掉我们的重置操作。

      count++;
    } catch (error) {
      console.error(`[Season] 用户 ${user.realName} 归档失败:`, error);
    }
  }

  console.log(`[Season] 归档完成，已重置 ${count} 名用户数据`);
};
