import { Request, Response } from 'express';
import Submission from '../models/submission.model';
import { success, fail } from '../utils/response';
import dayjs from 'dayjs';

// 1. 获取图表聚合数据 (Charts Overview)
// 定义难度区间 Key
const DIFF_KEYS = [
  '0', '1-1999', '1200-1399', '1400-1599', '1600-1899', '1900-2099',
  '2100-2399', '2400-2599', '2600-2999', '3000+'
];

// 辅助函数：根据分数获取区间 Key
const getDiffRangeKey = (rating: number) => {
  if (!rating || rating === 0) return '0'; // N/A
  if (rating < 1200) return '1-1199';
  if (rating < 1400) return '1200-1399';
  if (rating < 1600) return '1400-1599';
  if (rating < 1900) return '1600-1899';
  if (rating < 2100) return '1900-2099';
  if (rating < 2400) return '2100-2399';
  if (rating < 2600) return '2400-2599';
  if (rating < 3000) return '2600-2999';
  return '3000+';
};

// 获取数据概览 (包含 Top Cards 和 图表数据)
export const getChartData = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId || (req.user as any).userId;
    const period = req.query.period as string;
    // 1. 查询该用户所有 AC 记录，只取需要的字段以减少流量
    // sort({ solveTime: 1 }) 是为了后续生成热力图和趋势图方便
    const submissions = await Submission.find({ userId })
      .select('solveTime difficulty rawDifficulty problemId title')
      .sort({ solveTime: 1 })
      .lean();

    const now = dayjs();
    const currentYear = now.year();

    const startOf7DaysAgo = now.subtract(7, 'day').toDate();
    const startOf30DaysAgo = now.subtract(30, 'day').toDate();
    const startOfThisYear = now.startOf('year').toDate();

    // Charts 的动态时间节点 (根据用户选择)
    let chartStartTime = now.subtract(30, 'day'); // 默认 30d
    if (period === '7d') chartStartTime = now.subtract(7, 'day');
    if (period === '1y') chartStartTime = now.subtract(1, 'year');

    // 2. 初始化统计数据
    const stats = {
      total: submissions.length,
      last7Days: 0,
      last30Days: 0,
      thisYear: 0,

      // Charts 数据 (难度分布)
      difficultyStats: DIFF_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {} as Record<string, number>),
      
      // Heatmaps 数据 (日历热力图 - 不受 period 限制，通常展示全年)
      calendarHeatmap: {} as Record<string, { count: number; problems: any[] }>,
      calendarMaxDiff: {} as Record<string, number>,
      
      // Activity 数据 (趋势图 - 受 period 限制)
      activityStats: [] as any[]
      // ... (其他图表数据初始化，如 difficultyStats 等，这里省略以聚焦你的问题)
    };

    // 辅助 Map 用于聚合 Activity 数据
    // Key: "MM-DD" (7d/30d) 或 "MMM" (1y) -> Value: { '0': 1, '1-1199': 2 ... }
    const activityMap = new Map<string, Record<string, number>>();

    // 3. 遍历计算 (一次遍历完成所有统计)
    for (const sub of submissions) {
      const solveTime = new Date(sub.solveTime); // 确保是 Date 对象
      const dayjsTime = dayjs(solveTime);
      const dateStr = dayjsTime.format('YYYY-MM-DD');
      const diff = sub.difficulty || 0;
      const rangeKey = getDiffRangeKey(diff);
      // --- A. 核心统计逻辑 (Top Cards) ---
      if (solveTime >= startOf7DaysAgo) stats.last7Days++;
      if (solveTime >= startOf30DaysAgo) stats.last30Days++;
      if (solveTime >= startOfThisYear) stats.thisYear++;

      // --- B. 热力图数据 (包含详细题目信息用于 Tooltip) ---
      if (!stats.calendarHeatmap[dateStr]) {
        stats.calendarHeatmap[dateStr] = { count: 0, problems: [] };
      }
      stats.calendarHeatmap[dateStr].count++;
      stats.calendarHeatmap[dateStr].problems.push({
        id: sub.problemId || 'Unknown',
        title: sub.title || '',
        diff: sub.difficulty || 'N/A',
        rating: diff
      });

      // 记录当天最大难度
      if (diff > 0) {
        const currentMax = stats.calendarMaxDiff[dateStr] || 0;
        if (diff > currentMax) stats.calendarMaxDiff[dateStr] = diff;
      }

      // --- C. 图表数据 (受 Period 过滤) ---
      if (dayjsTime.isAfter(chartStartTime)) {
        // 1. 难度分布统计
        if (stats.difficultyStats[rangeKey] !== undefined) {
          stats.difficultyStats[rangeKey]++;
        }

        // 2. Activity 趋势图统计
        // 根据 period 决定聚合粒度：1y 按月聚合，其他按天聚合
        let activityKey = '';
        if (period === '1y') {
          activityKey = dayjsTime.format('MMM'); // e.g. "Jan", "Feb"
        } else {
          activityKey = dayjsTime.format('MMM DD'); // e.g. "Nov 25"
        }

        if (!activityMap.has(activityKey)) {
          // 初始化该时间点的难度计数器
          const initCounts = DIFF_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<string, number>);
          activityMap.set(activityKey, initCounts);
        }
        
        // 累加该难度
        activityMap.get(activityKey)![rangeKey]++;
      }
    }

    // 4. 格式化 Activity 数据供 ECharts 使用
    // 将 Map 转为数组: [{ date: 'Nov 25', '0': 1, '1-1199': 0 ... }, ...]
    // 注意：Map 的遍历顺序通常是插入顺序（即时间顺序），因为我们之前对 submissions 排序过
    stats.activityStats = Array.from(activityMap.entries()).map(([date, counts]) => ({
      date,
      ...counts
    }));

    // 4. 返回结果
    success(res, stats);

  } catch (e: any) {
    console.error('Get stats failed:', e);
    fail(res, '获取统计数据失败');
  }
};

// 2. 获取表格列表数据 (支持分页筛选)
export const getTableData = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId || (req.user as any).userId;
    const page = Number(req.query.page) || 1;
    const size = Number(req.query.size) || 10;
    
    // 🟢 接收截图中的所有筛选参数
    const { sources, problemId, title, minDiff, maxDiff, tags, startDate, endDate } = req.query;

    const query: any = { userId };

    // 1. 来源筛选 (多选) -> sources="CodeForces,AtCoder"
    if (sources) {
      const sourceList = String(sources).split(',').filter(Boolean);
      if (sourceList.length > 0) query.platform = { $in: sourceList };
    }

    // 2. 独立搜索 (ID 和 标题)
    if (problemId) query.problemId = { $regex: new RegExp(String(problemId), 'i') };
    if (title) query.title = { $regex: new RegExp(String(title), 'i') };

    // 3. 难度范围
    if (minDiff || maxDiff) {
      query.difficulty = {};
      if (minDiff) query.difficulty.$gte = Number(minDiff);
      if (maxDiff) query.difficulty.$lte = Number(maxDiff);
    }

    // 4. 标签筛选 (模糊匹配)
    if (tags) {
      // 假设 tag 也是字符串，这里做简单包含查询
      // 如果你需要更复杂的 tag 数组查询，需根据数据库结构调整
      query.tags = { $in: [new RegExp(String(tags), 'i')] }; 
    }

    // 5. 时间范围
    if (startDate && endDate) {
      query.solveTime = {
        $gte: new Date(String(startDate)),
        $lte: new Date(String(endDate))
      };
    }

    const [total, list] = await Promise.all([
      Submission.countDocuments(query),
      Submission.find(query)
        .sort({ solveTime: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .lean()
    ]);

    success(res, { total, list, page, size });
  } catch (e: any) {
    fail(res, e.message);
  }
};