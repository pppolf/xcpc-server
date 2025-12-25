import axios from 'axios';
import { normalizeDifficulty, clipDifficulty } from './index';

// AtCoder API: https://kenkoooo.com/atcoder/atcoder-api/v3/
const API_BASE = 'https://kenkoooo.com/atcoder/atcoder-api/v3';

export const crawlAtCoder = async (username: string) => {
  try {
    // 1. 并发获取题目难度信息和题目详情，提高效率
    const [problemsRes, problemDetail] = await Promise.all([
      axios.get('https://kenkoooo.com/atcoder/resources/problem-models.json', { timeout: 10000 }),
      axios.get('https://kenkoooo.com/atcoder/resources/problems.json', { timeout: 10000 })
    ]);

    // 2. 构建题目ID到题目名称的映射
    const pid_pname: Record<string, string> = {};
    problemDetail.data.forEach((item: any) => {
      pid_pname[item.id] = item.name;
    });

    // 3. 获取用户所有提交记录
    const url = `${API_BASE}/user/submissions?user=${username}&from_second=0`;
    const res = await axios.get(url, { timeout: 10000 });
    
    // 4. 筛选出 AC 的提交
    const acceptedSubmissions = res.data.filter((sub: any) => sub.result === 'AC');

    // A：按提交时间升序排序 (epoch_second 越小越早)
    // 确保我们处理的时候，先处理的是最早的提交
    acceptedSubmissions.sort((a: any, b: any) => a.epoch_second - b.epoch_second);

    // B：去重逻辑
    const uniqueSubmissions: any[] = [];
    const seenProblemIds = new Set<string>();

    for (const sub of acceptedSubmissions) {
      // 如果这个题目ID之前没出现过，说明这是排序后的第一条（也就是最早的一条）AC记录
      if (!seenProblemIds.has(sub.problem_id)) {
        seenProblemIds.add(sub.problem_id);
        uniqueSubmissions.push(sub);
      }
      // 如果出现过，说明是重复刷题，直接跳过
    }

    // 5. 映射最终结果
    return uniqueSubmissions.map((sub: any) => {
      // 获取难度分 (可能为 undefined)
      const rawDiff = problemsRes.data[sub.problem_id]?.difficulty;
      // 计算难度
      const difficulty = rawDiff !== undefined 
        ? normalizeDifficulty('AtCoder', clipDifficulty(Number(rawDiff))) 
        : 0;

      return {
        platform: 'AtCoder',
        remoteId: sub.id.toString(), // 提交ID
        title: pid_pname[sub.problem_id] || sub.problem_id, // 优先用名字，没有则用ID兜底
        problemId: sub.problem_id,
        link: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
        solveTime: new Date(sub.epoch_second * 1000), // 时间戳转 Date
        rawDifficulty: rawDiff !== undefined ? String(rawDiff) : 'N/A', // 原始难度参考
        difficulty: difficulty,
        tags: [] 
      };
    });

  } catch (error) {
    console.error(`AtCoder crawl error for ${username}:`, error);
    return [];
  }
};