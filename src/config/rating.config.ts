import { getCurrentSeason } from "../services/config.service";

export const RATING_CONFIG = {
  // 赛季设置
  CURRENT_SEASON: getCurrentSeason(),
  
  // 1. 比赛分配置
  CONTEST: {
    TOP_N: 10, // 取前10场
    BASE_SCORE: {
      XCPC: 1000,
      AWARD: 100,
      CAMP: 1000
    },
    // 权重映射
    WEIGHTS: {
      // XCPC
      'XCPC_FINAL': 2.0,
      'XCPC_REGIONAL': 1.0,
      'XCPC_NET': 0.8,
      'XCPC_INVITATIONAL': 0.5,
      'XCPC_PROVINCIAL': 0.1,
      'XCPC_CAMPUS': 0.05,
      'XCPC_TRAINING': 0.01,
      // 训练营
      'CAMP_NOWCODER_WINTER': 0.5,
      'CAMP_NOWCODER_SUMMER': 1.0,
      'CAMP_HDU_SPRING': 0.8,
      'CAMP_HDU_SUMMER': 1.3,
    },
    // 奖项类
    // 奖项权重字典 (Key = 比赛类型_等级)
    AWARD_WEIGHTS: {
      // 1. 天梯赛 (GPLT)
      'GPLT_NAT_1': 0.5,
      'GPLT_NAT_2': 0.3,
      'GPLT_NAT_3': 0.1,
      'GPLT_PROV_1': 0,
      'GPLT_PROV_2': 0,
      'GPLT_PROV_3': 0,

      // 2. 蓝桥杯 (LANQIAO)
      'LANQIAO_NAT_1': 0.5,
      'LANQIAO_NAT_2': 0.3,
      'LANQIAO_NAT_3': 0.1,
      'LANQIAO_PROV_1': 0.05,
      'LANQIAO_PROV_2': 0.03,
      'LANQIAO_PROV_3': 0.01,

      // 3. 百度之星 (ASTAR)
      'ASTAR_NAT_1': 2.0,
      'ASTAR_NAT_2': 1.5,
      'ASTAR_NAT_3': 1.0,
      'ASTAR_PROV_1': 0.8,
      'ASTAR_PROV_2': 0.5,
      'ASTAR_PROV_3': 0.2,

      // 4. PAT
      'PAT_TOP': 1.0,  // 顶级
      'PAT_ADV': 0.5,  // 甲级
      'PAT_BAS': 0.3,  // 乙级

      // 5. 计算机能力挑战赛 (NCCCU)
      'NCCCU_NAT_1': 0.1,
      'NCCCU_NAT_2': 0.05,
      'NCCCU_NAT_3': 0.01,
      'NCCCU_PROV_1': 0,
      'NCCCU_PROV_2': 0,
      'NCCCU_PROV_3': 0
    },
    // 奖项衰减系数 [本赛季, 上赛季, 上上赛季, ...]
    AWARD_DECAY: [1.0, 0.8, 0.4, 0.2, 0] 
  },

  // 2. 刷题分配置
  PRACTICE: {
    SEASON_MAX: 500, // 赛季上限
    MONTH_THRESHOLD: 60, // 月度阈值 T_month
    SCORE_PER_PROBLEM: 0.5, // 单题分数
    K_INITIAL: 1.0,    // 初始系数
    K_INCREMENT: 0.1,  // 达标奖励
    K_DECREMENT: 0.2,  // 不达标惩罚
    K_MAX: 1.0,
    K_MIN: 0
  },

  // 3. 历史衰减配置
  LEGACY: {
    FACTOR: 0.6 // 衰减因子 s
  }
};