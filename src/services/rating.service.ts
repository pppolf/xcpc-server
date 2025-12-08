// src/services/rating.service.ts
import ContestRecord from '../models/contest-record.model';
import PracticeMonthStats from '../models/practice-stats.model';
import SeasonRating from '../models/season-rating.model';
import User from '../models/user.model';
import { RATING_CONFIG } from '../config/rating.config';
import { getSeasonDiff } from '../utils/season.helper';

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
  const currentSeason = RATING_CONFIG.CURRENT_SEASON;
  
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
    
    return base * weight * decay;
  }

  // === B. 常规比赛/训练营 (XCPC, CAMP) ===
  // 规则：只认定本赛季
  if (season !== currentSeason) {
    return 0; 
  }

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

  const score = base * ((N - rk + 1) / N) * weight;
  
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

// [核心修复] 结算某个月的刷题分 (并保存到数据库)
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
        season: RATING_CONFIG.CURRENT_SEASON,
        problemCount,
        activeCoefficient: k,
        monthScore: parseFloat(monthScore.toFixed(2)),
        isSettled: true
      }
    },
    { upsert: true, new: true }
  );
  
  return { k, monthScore };
};

// 计算本赛季总刷题分 (求和所有月，上限 500)
export const calculatePracticeRating = async (userId: string) => {
  const stats = await PracticeMonthStats.find({ 
    userId, 
    season: RATING_CONFIG.CURRENT_SEASON 
  });
  
  const total = stats.reduce((sum, s) => sum + s.monthScore, 0);
  
  return Math.min(RATING_CONFIG.PRACTICE.SEASON_MAX, parseFloat(total.toFixed(2)));
};

// 计算历史衰减分
export const calculateLegacyRating = async (userId: string) => {
  const { FACTOR } = RATING_CONFIG.LEGACY;
  const currentSeason = RATING_CONFIG.CURRENT_SEASON;
  
  const history = await SeasonRating.find({ 
    userId, 
    season: { $ne: currentSeason } // 排除当前赛季
  });
  
  let totalLegacy = 0;
  
  for (const rec of history) {
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
    ratingInfo: { // 统一使用 ratingInfo
      contest: rContest,
      problem: rProblem,
      legacy: rLegacy
    }
  });

  return finalRating;
};