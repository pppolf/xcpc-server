// import axios from 'axios';
// import { normalizeDifficulty, clipDifficulty } from './index';

// // AtCoder API: https://kenkoooo.com/atcoder/atcoder-api/v3/
// const API_BASE = 'https://kenkoooo.com/atcoder/atcoder-api/v3';

// export const crawlAtCoder = async (username: string) => {
//   try {
//     // 1. 并发获取题目难度信息和题目详情，提高效率
//     const [problemsRes, problemDetail] = await Promise.all([
//       axios.get('https://kenkoooo.com/atcoder/resources/problem-models.json', { timeout: 10000 }),
//       axios.get('https://kenkoooo.com/atcoder/resources/problems.json', { timeout: 10000 })
//     ]);

//     // 2. 构建题目ID到题目名称的映射
//     const pid_pname: Record<string, string> = {};
//     problemDetail.data.forEach((item: any) => {
//       pid_pname[item.id] = item.name;
//     });

//     // 3. 获取用户所有提交记录
//     const url = `${API_BASE}/user/submissions?user=${username}&from_second=0`;
//     const res = await axios.get(url, { timeout: 10000 });
    
//     // 4. 筛选出 AC 的提交
//     const acceptedSubmissions = res.data.filter((sub: any) => sub.result === 'AC');

//     // A：按提交时间升序排序 (epoch_second 越小越早)
//     // 确保我们处理的时候，先处理的是最早的提交
//     acceptedSubmissions.sort((a: any, b: any) => a.epoch_second - b.epoch_second);

//     // B：去重逻辑
//     const uniqueSubmissions: any[] = [];
//     const seenProblemIds = new Set<string>();

//     for (const sub of acceptedSubmissions) {
//       // 如果这个题目ID之前没出现过，说明这是排序后的第一条（也就是最早的一条）AC记录
//       if (!seenProblemIds.has(sub.problem_id)) {
//         seenProblemIds.add(sub.problem_id);
//         uniqueSubmissions.push(sub);
//       }
//       // 如果出现过，说明是重复刷题，直接跳过
//     }

//     // 5. 映射最终结果
//     return uniqueSubmissions.map((sub: any) => {
//       // 获取难度分 (可能为 undefined)
//       const rawDiff = problemsRes.data[sub.problem_id]?.difficulty;
//       // 计算难度
//       const difficulty = rawDiff !== undefined 
//         ? normalizeDifficulty('AtCoder', clipDifficulty(Number(rawDiff))) 
//         : 0;

//       return {
//         platform: 'AtCoder',
//         remoteId: sub.id.toString(), // 提交ID
//         title: pid_pname[sub.problem_id] || sub.problem_id, // 优先用名字，没有则用ID兜底
//         problemId: sub.problem_id,
//         link: `https://atcoder.jp/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
//         solveTime: new Date(sub.epoch_second * 1000), // 时间戳转 Date
//         rawDifficulty: rawDiff !== undefined ? String(rawDiff) : 'N/A', // 原始难度参考
//         difficulty: difficulty,
//         tags: [] 
//       };
//     });

//   } catch (error) {
//     console.error(`AtCoder crawl error for ${username}:`, error);
//     return [];
//   }
// };

import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeDifficulty, clipDifficulty } from './index';
import GlobalSetting from '../../models/global-setting.model';
import { AtCoderCookieExpiredError } from '../errors';

// ==========================================
// 🔴 配置区域 (请在此处填入你的 Cookie)
// ==========================================
// 把你从浏览器 F12 -> Application -> Cookies -> REVEL_SESSION 复制的值粘贴到下面
// 注意：不要把这个代码上传到公开仓库，否则别人能登录你的号！

const ATCODER_BASE = 'https://atcoder.jp';
const METADATA_BASE = 'https://kenkoooo.com/atcoder/resources';
const CONFIG_KEY = 'atcoder_cookie'; // 数据库中存储 Cookie 的 Key

// 请求头配置：带上 Cookie 和 User-Agent
const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface ScrapedSubmission {
  epoch_second: number;
  problem_id: string;
  contest_id: string;
  id: string;
  title: string;
  point: string;
}

async function getHeaders() {
  // 1. 从数据库查询最新的 Cookie
  const config = await GlobalSetting.findOne({ key: CONFIG_KEY });
  
  if (!config || !config.value) {
    throw new Error(`❌ 系统配置缺失: 请在后台设置 Key 为 "${CONFIG_KEY}" 的 Cookie 值`);
  }

  // 2. 合并返回
  return {
    ...BASE_HEADERS,
    'Cookie': config.value.trim()
  };
}

// 步骤 1: 获取比赛历史
async function fetchUserContestHistory(username: string, headers: any): Promise<string[]> {
  try {
    const res = await axios.get(`${ATCODER_BASE}/users/${username}/history`, { 
      headers, 
      timeout: 10000 
    });
    const $ = cheerio.load(res.data);
    const contestIds: string[] = [];

    $('#history tr').each((_, el) => {
      const link = $(el).find('td a[href^="/contests/"]').attr('href');
      if (link) {
        const parts = link.split('/');
        if (parts.length >= 3) contestIds.push(parts[2]);
      }
    });
    return Array.from(new Set(contestIds));
  } catch (error: any) {
    console.error(`获取比赛历史失败: ${error.message}`);
    return [];
  }
}

// 步骤 2: 获取单场比赛提交
async function fetchContestSubmissions(username: string, contestId: string, headers: any): Promise<ScrapedSubmission[]> {
  const url = `${ATCODER_BASE}/contests/${contestId}/submissions?f.User=${username}&f.Status=AC`;
  const submissions: ScrapedSubmission[] = [];

  try {
    const res = await axios.get(url, { 
      headers,
      timeout: 10000,
      maxRedirects: 0, // 禁止自动跳转，这样如果是 302 重定向我们可以捕获
      validateStatus: (status) => status >= 200 && status < 400 // 允许 3xx 状态码
    });

    // 如果状态码是 302 Found 且跳到了 login，说明 Cookie 过期了或者没权访问
    if (res.status === 302 && res.headers.location?.includes('login')) {
      console.error(`🚨 检测到 Cookie 失效，在访问比赛 ${contestId} 时被重定向。停止任务。`);
      throw new AtCoderCookieExpiredError();
    }

    const $ = cheerio.load(res.data);
    const rows = $('tbody tr');

    rows.each((_, el) => {
      const tds = $(el).find('td');
      if (tds.length === 0) return;

      const timeStr = $(tds[0]).text().trim();
      const solveDate = new Date(timeStr);
      const epoch_second = Math.floor(solveDate.getTime() / 1000);

      const taskLink = $(tds[1]).find('a');
      const taskUrl = taskLink.attr('href') || '';
      const title = taskLink.text().trim();
      const problemIdMatch = taskUrl.match(/\/tasks\/([^\/]+)$/);
      const problemId = problemIdMatch ? problemIdMatch[1] : '';
      
      const point = $(tds[4]).text().trim();

      let detailUrl = '';
      $(el).find('a').each((_, a) => {
        const href = $(a).attr('href');
        if (href && href.includes('/submissions/')) detailUrl = href;
      });
      const idMatch = detailUrl.match(/\/submissions\/(\d+)$/);
      const remoteId = idMatch ? idMatch[1] : '';

      if (problemId && remoteId) {
        submissions.push({ epoch_second, problem_id: problemId, contest_id: contestId, id: remoteId, title, point });
      }
    });
  } catch (e: any) {
    if (e instanceof AtCoderCookieExpiredError) {
      throw e;
    }
    // 其他网络小错误（比如超时）可以选择忽略，继续爬下一个比赛
    console.warn(`抓取比赛 ${contestId} 失败 (非Cookie原因):`, e.message);
    return [];
  }
  return submissions;
}

export const crawlAtCoder = async (username: string) => {
  try {
    // 检查 Cookie 是否填写
    let headers;
    try {
      headers = await getHeaders();
    } catch (e: any) {
      console.error(e.message);
      return [];
    }

    console.log('正在加载元数据...');
    const [modelsResult, problemsResult] = await Promise.allSettled([
      axios.get(`${METADATA_BASE}/problem-models.json`, { timeout: 5000 }),
      axios.get(`${METADATA_BASE}/problems.json`, { timeout: 5000 })
    ]);
    const problemModels = modelsResult.status === 'fulfilled' ? modelsResult.value.data : {};
    const problemList = problemsResult.status === 'fulfilled' ? problemsResult.value.data : [];
    const pid_pname: Record<string, string> = {};
    if (Array.isArray(problemList)) problemList.forEach((item: any) => pid_pname[item.id] = item.name);

    console.log(`正在获取 ${username} 的比赛历史 (携带 Cookie)...`);
    const contestIds = await fetchUserContestHistory(username, headers);
    
    if (contestIds.length === 0) return [];

    console.log(`找到 ${contestIds.length} 场比赛。开始抓取...`);
    let allSubmissions: ScrapedSubmission[] = [];
    
    for (const cid of contestIds) {
      const contestSubs = await fetchContestSubmissions(username, cid, headers);
      if (contestSubs.length > 0) {
        console.log(`  ✅ ${cid}: ${contestSubs.length} AC`);
        allSubmissions = allSubmissions.concat(contestSubs);
      }
      await sleep(500); 
    }

    // 排序与去重
    allSubmissions.sort((a, b) => a.epoch_second - b.epoch_second);
    const uniqueSubmissions: ScrapedSubmission[] = [];
    const seenProblemIds = new Set<string>();

    for (const sub of allSubmissions) {
      if (!seenProblemIds.has(sub.problem_id)) {
        seenProblemIds.add(sub.problem_id);
        uniqueSubmissions.push(sub);
      }
    }

    console.log(`抓取完成，共 ${uniqueSubmissions.length} 条。`);

    return uniqueSubmissions.map((sub) => {
      const model = problemModels[sub.problem_id];
      const rawDiff = model?.difficulty;
      const difficulty = rawDiff !== undefined ? normalizeDifficulty('AtCoder', clipDifficulty(Number(rawDiff))) : 0;
      const finalTitle = pid_pname[sub.problem_id] || sub.title.split('-')[1].trim() || sub.problem_id;

      return {
        platform: 'AtCoder',
        remoteId: sub.id,
        title: finalTitle,
        problemId: sub.problem_id,
        link: `${ATCODER_BASE}/contests/${sub.contest_id}/tasks/${sub.problem_id}`,
        solveTime: new Date(sub.epoch_second * 1000),
        rawDifficulty: rawDiff !== undefined ? String(rawDiff) : sub.point,
        difficulty: difficulty,
        tags: []
      };
    });

  } catch (error) {
    if (error instanceof AtCoderCookieExpiredError) {
      throw error; 
    }
    console.error(`AtCoder crawl error for ${username}:`, error);
    return [];
  }
};