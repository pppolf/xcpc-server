// 难度标准化映射
export const normalizeDifficulty = (platform: string, raw: string | number): number => {
  const val = Number(raw);

  switch (platform) {
    case 'CodeForces':
    case 'AtCoder':
      // 直接返回原始分数，如果无效则返回 0
      return isNaN(val) ? 0 : val;

    case 'Luogu':
      // 洛谷难度 ID 映射
      // raw 应该是洛谷 API 返回的 difficulty 字段 (0-7)
      // 或者爬虫解析出来的 ID
      const luoguMap: Record<number, number> = {
        0: 0,    // 暂无评定 -> N/A (0)
        1: 800,  // 红 (入门)
        2: 1100,  // 橙 (普及-)
        3: 1500, // 黄 (普及/提高-)
        4: 1800, // 绿 (普及+/提高)
        5: 2200, // 蓝 (提高+/省选-)
        6: 2600, // 紫 (省选/NOI-)
        7: 3200  // 黑 (NOI/NOI+/CTSC)
      };
      // 如果传入的是数字，直接映射；如果是字符串(防止意外)，尝试转数字
      return luoguMap[val] || 0;

    case 'NowCoder':
    case 'CWNUOJ':
    default:
      // 其他平台难度统一为 0 (前端渲染时判断为 0 则显示 N/A)
      return 0;
  }
};


export const clipDifficulty = (difficulty: number): number =>
  Math.round(
    difficulty >= 400 ? difficulty : 400 / Math.exp(1.0 - difficulty / 400)
  );