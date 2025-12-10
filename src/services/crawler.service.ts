// src/services/crawler.service.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import User from '../models/user.model';
import CrawlerLog from '../models/crawler-log.model';
import PracticeMonthStats from '../models/practice-stats.model';
import { getCurrentSeason } from './config.service';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Cookie': '__client_id=fake_client_id_for_crawler;', 
};

// 定义单项爬取结果接口
interface CrawlerResult {
  count: number;
  error?: string; // 如果有错，这里存错误信息
}

// 1. Codeforces
const fetchCodeforces = async (handle: string): Promise<CrawlerResult> => {
  if (!handle) return { count: 0 };
  try {
    const url = `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=10000`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 15000 });
    if (res.data.status !== 'OK') return { count: 0, error: 'CF API Status not OK' };
    
    const solvedSet = new Set<string>();
    res.data.result.forEach((sub: any) => {
      if (sub.verdict === 'OK') {
        solvedSet.add(`${sub.problem.contestId}${sub.problem.index}`);
      }
    });
    return { count: solvedSet.size };
  } catch (error: any) {
    const msg = error.response?.status === 400 ? 'CF账号不存在或格式错误' : error.message;
    console.error(`CF Error [${handle}]:`, msg);
    return { count: 0, error: `CF: ${msg}` };
  }
};

// 2. AtCoder
const fetchAtCoder = async (handle: string): Promise<CrawlerResult> => {
  if (!handle) return { count: 0 };
  try {
    const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=0`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 15000 });
    const solvedSet = new Set<string>();
    res.data.forEach((sub: any) => {
      if (sub.result === 'AC') solvedSet.add(sub.problem_id);
    });
    return { count: solvedSet.size };
  } catch (error: any) {
    console.error(`AtCoder Error [${handle}]:`, error.message);
    return { count: 0, error: `AT: ${error.message}` };
  }
};

// 3. 牛客
const fetchNowCoder = async (userId: string): Promise<CrawlerResult> => {
  if (!userId) return { count: 0 };
  try {
    const url = `https://ac.nowcoder.com/acm/contest/profile/${userId}/practice-coding`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 10000 });
    const $ = cheerio.load(res.data);
    let passedCount = 0;
    $('.my-state-item').each((i, el) => {
      if ($(el).text().includes('题已通过')) {
        passedCount = parseInt($(el).find('.state-num').text().trim(), 10);
        return false; 
      }
    });
    return { count: isNaN(passedCount) ? 0 : passedCount };
  } catch (error: any) {
    console.error(`NC Error [${userId}]:`, error.message);
    return { count: 0, error: `NC: ${error.message}` };
  }
};

// 4. 洛谷
const getLuoguUid = async (keyword: string): Promise<string | null> => {
  try {
    const searchUrl = `https://www.luogu.com.cn/api/user/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await axios.get(searchUrl, {
      headers: { ...COMMON_HEADERS, 'x-requested-with': 'XMLHttpRequest' },
      timeout: 5000
    });
    if (res.data?.users?.length > 0) return res.data.users[0].uid.toString();
    return null;
  } catch (e) { return null; }
};

const fetchLuogu = async (input: string): Promise<CrawlerResult> => {
  if (!input) return { count: 0 };
  let targetUid = input;
  // 如果不是纯数字，先转 ID
  if (!/^\d+$/.test(input)) {
    const uid = await getLuoguUid(input);
    if (!uid) return { count: 0, error: `LG: 未找到用户 ${input}` };
    targetUid = uid;
  }

  try {
    const url = `https://www.luogu.com.cn/user/${targetUid}`;
    const res = await axios.get(url, { 
      headers: { ...COMMON_HEADERS, 'Referer': 'https://www.luogu.com.cn/', 'x-requested-with': 'XMLHttpRequest' },
      timeout: 10000,
      maxRedirects: 5 
    });
    
    let count = 0;
    // 尝试 JSON 解析
    if (typeof res.data === 'object' && res.data.currentData) {
        count = res.data.currentData.user?.passedProblemCount || 0;
    } else {
        // 尝试 HTML 解析
        const $ = cheerio.load(res.data);
        let scriptContent = $('#lentille-context').text();
        if (scriptContent) {
            try {
                if (scriptContent.includes('%7B')) scriptContent = decodeURIComponent(scriptContent);
                const json = JSON.parse(scriptContent);
                count = json?.data?.user?.passedProblemCount || 0;
            } catch (e) {}
        }
    }
    
    return { count };
  } catch (error: any) {
    const msg = error.response?.status === 403 ? '403被拦截' : error.message;
    console.error(`LG Error [${targetUid}]:`, msg);
    return { count: 0, error: `LG: ${msg}` };
  }
};

// 爬取校内OJ
const fetchCWNUOJ = async (input: string): Promise<CrawlerResult> => {
  if (!input) return { count: 0 };
  try {
    const url = `https://oj.cwnu.online-judge.cn/api/stats/${input}`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 15000 });
    return { count: res.data.data };
  } catch (error: any) {
    console.error(`CWNUOJ Error [${input}]:`, error.message);
    return { count: 0, error: `CWNUOJ: ${error.message}` };
  }
}

// 聚合函数 (收集错误)
export const fetchOjData = async (ojInfo: any) => {
  console.log(`[Crawler] 开始爬取...`);
  const [cf, at, nc, lg, cwnuoj] = await Promise.all([
    fetchCodeforces(ojInfo.cf),
    fetchAtCoder(ojInfo.at),
    fetchNowCoder(ojInfo.nc),
    fetchLuogu(ojInfo.lg),
    fetchCWNUOJ(ojInfo.cwnuoj)
  ]);

  console.log(`[Crawler] 结果: CF:${cf.count}, AT:${at.count}, NC:${nc.count}, LG:${lg.count}, CWNUOJ:${cwnuoj.count}`);
  
  // 收集所有的非空错误信息
  const errors = [cf.error, at.error, nc.error, lg.error, cwnuoj.error].filter(Boolean) as string[];

  return { 
    counts: {
      cf: cf.count,
      at: at.count,
      nc: nc.count,
      lg: lg.count,
      cwnuoj: cwnuoj.count, 
    },
    total: cf.count + at.count + nc.count + lg.count + cwnuoj.count,
    errors // 返回错误列表
  };
};

// ---------------------------------------------------------
// 业务逻辑
// ---------------------------------------------------------

export const refreshUserSolvedStats = async (userId: string, triggerType: 'MANUAL' | 'AUTO' = 'MANUAL') => {
  const user = await User.findById(userId);
  if (!user) throw new Error('用户不存在');

  // 1. 爬取数据
  const { counts, total, errors } = await fetchOjData(user.ojInfo);
  
  // 2. 查上次记录
  const lastLog = await CrawlerLog.findOne({ userId }).sort({ createdAt: -1 });
  const lastTotal = lastLog ? lastLog.totalSolved : 0;
  const increment = Math.max(0, total - lastTotal); 

  // 3. 记日志
  await CrawlerLog.create({
    userId,
    triggerType,
    details: counts,
    totalSolved: total,
    increment: increment
  });

  // 4. 更新数据库 (仅更新数量)
  if (increment > 0) {
    const now = new Date();
    user.problemNumber = total;
    await user.save();

    await PracticeMonthStats.findOneAndUpdate(
      { userId, year: now.getFullYear(), month: now.getMonth() + 1 },
      { 
        $set: { problemCount: increment }, 
      },
      { upsert: true }
    );
  }

  return { 
    previous: lastTotal, 
    current: total, 
    increment,
    details: counts,
    errors // 🔴 将错误信息透传给 Controller -> Frontend
  };
};

const randomDelay = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

// 批量刷新逻辑保持不变，它会调用 refreshUserSolvedStats 并接收 errors
export const refreshAllMembers = async () => {
  const users = await User.find({ role: { $ne: 'Teacher' } });
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const user of users) {
    try {
      const res = await refreshUserSolvedStats(user._id.toString(), 'MANUAL');
      
      // 判断是否有部分 OJ 失败
      const hasWarning = res.errors && res.errors.length > 0;
      
      results.push({
        userId: user._id,
        name: user.realName,
        status: 'success', // 只要不是代码崩了，就算 success，但在前端标记为 warning
        increment: res.increment,
        total: res.current,
        warnings: res.errors // 传递警告信息
      });
      successCount++;
      const delay = randomDelay(2000, 5000);
      console.log(`[Batch] 等待 ${delay}ms 后继续...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error: any) {
      results.push({
        userId: user._id,
        name: user.realName,
        status: 'fail', // 只有代码彻底崩了才算 fail
        error: error.message
      });
      failCount++;
    }
  }
  return { total: users.length, successCount, failCount, details: results };
};