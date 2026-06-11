// src/services/crawler.service.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import User from '../models/user.model';
import CrawlerLog from '../models/crawler-log.model';
import PracticeMonthStats from '../models/practice-stats.model';
import { getCurrentSeason } from './config.service';
import * as https from 'https';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Cookie': '__client_id=fake_client_id_for_crawler;', 
};

// 定义单项爬取结果接口
interface CrawlerResult {
  count: number | null;
  error?: string; // 如果有错，这里存错误信息
}

// 1. Codeforces
const fetchCodeforces = async (handle: string): Promise<CrawlerResult> => {
  if (!handle) return { count: 0 };
  try {
    const url = `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=10000`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 150000 });
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
    // console.error(`CF Error [${handle}]:`, msg);
    return { count: null, error: `CF: ${msg}` };
  }
};

// 2. AtCoder
const fetchAtCoder = async (handle: string): Promise<CrawlerResult> => {
  if (!handle) return { count: 0 };
  try {
    const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${handle}&from_second=0`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 50000 });
    const solvedSet = new Set<string>();
    res.data.forEach((sub: any) => {
      if (sub.result === 'AC') solvedSet.add(sub.problem_id);
    });
    return { count: solvedSet.size };
  } catch (error: any) {
    // console.error(`AtCoder Error [${handle}]:`, error.message);
    return { count: null, error: `AT: ${error.message}` };
  }
};

// 3. 牛客
const fetchNowCoder = async (userId: string): Promise<CrawlerResult> => {
  if (!userId) return { count: 0 };
  try {
    const url = `https://ac.nowcoder.com/acm/contest/profile/${userId}/practice-coding`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 100000 });
    const $ = cheerio.load(res.data);
    let passedCount = 0;
    $('.my-state-item').each((i, el) => {
      if ($(el).text().includes('题已通过')) {
        passedCount = parseInt($(el).find('.state-num').text().trim(), 10);
        return false; 
      }
    });
    return { count: isNaN(passedCount) ? null : passedCount };
  } catch (error: any) {
    // console.error(`NC Error [${userId}]:`, error.message);
    return { count: null, error: `NC: ${error.message}` };
  }
};

// 4. 洛谷
const getLuoguUid = async (keyword: string): Promise<string | null> => {
  try {
    const searchUrl = `https://www.luogu.com.cn/api/user/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await axios.get(searchUrl, {
      headers: { ...COMMON_HEADERS, 'x-requested-with': 'XMLHttpRequest' },
      timeout: 50000
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
      timeout: 100000,
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
    // console.error(`LG Error [${targetUid}]:`, msg);
    return { count: null, error: `LG: ${msg}` };
  }
};


// 爬取校内OJ
const fetchCWNUOJ = async (input: string): Promise<CrawlerResult> => {
  if (!input) return { count: 0 };
  try {
    const url = `https://oj.cwnupaa.com/api/stats/${input}`;
    const agent = new https.Agent({
      rejectUnauthorized: false, // 忽略证书验证错误
      ciphers: 'DEFAULT@SECLEVEL=1' // 降低安全级别，允许使用旧版加密套件
    });
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 150000, httpsAgent: agent });
    return { count: res.data.data };
  } catch (error: any) {
    // console.error(`CWNUOJ Error [${input}]:`, error.message);
    return { count: null, error: `CWNUOJ: ${error.message}` };
  }
}

// 如果 newData 是 null (失败)，就用 oldData (数据库里的旧值)
// 如果 newData 是 number，就用 newData
const safeCount = (newData: number | null | undefined, oldData: number): number => {
  if (newData === null || newData === undefined) return oldData;
  return newData;
};

// 聚合函数 (收集错误)
export const fetchOjData = async (ojInfo: any, oldStats: any) => {
  console.log(`[Crawler] 开始爬取...`);
  const [cf, at, nc, lg, cwnuoj] = await Promise.all([
    fetchCodeforces(ojInfo.cf),
    fetchAtCoder(ojInfo.at),
    fetchNowCoder(ojInfo.nc),
    fetchLuogu(ojInfo.lg),
    fetchCWNUOJ(ojInfo.cwnuoj)
  ]);

  const newStats = {
    codeforces: safeCount(cf.count, oldStats.codeforces),
    atcoder:    safeCount(at.count, oldStats.atcoder),
    nowcoder:   safeCount(nc.count, oldStats.nowcoder),
    luogu:      safeCount(lg.count, oldStats.luogu),
    cwnuoj:     safeCount(cwnuoj.count, oldStats.cwnuoj),
    lastUpdate: new Date()
  };

  const total = newStats.codeforces + newStats.atcoder + newStats.nowcoder + newStats.luogu + newStats.cwnuoj;

  console.log(`[Crawler] 结果: CF:${newStats.codeforces}, AT:${newStats.atcoder}, NC:${newStats.nowcoder}, LG:${newStats.luogu}, CWNUOJ:${newStats.cwnuoj}`);
  
  // 收集所有的非空错误信息
  const errors = [cf.error, at.error, nc.error, lg.error, cwnuoj.error].filter(Boolean) as string[];

  if (errors.length > 0) {
    console.log(errors);
  }

  return { 
    newStats,
    total,
    errors // 返回错误列表
  };
};

// ---------------------------------------------------------
// 业务逻辑
// ---------------------------------------------------------

export const refreshUserSolvedStats = async (userId: string, triggerType: 'MANUAL' | 'AUTO' = 'MANUAL') => {
  const user = await User.findById(userId);
  if (!user) throw new Error('用户不存在');

  // 1. 获取旧数据 (作为缓存)
  // 确保 ojStats 存在 (如果是老数据可能没有这个字段)
  const oldStats = user.ojStats || { codeforces: 0, atcoder: 0, nowcoder: 0, luogu: 0, cwnuoj: 0 };

  // 1. 爬取数据
  const { newStats, total, errors } = await fetchOjData(user.ojInfo, oldStats);
  
  // 2. 查上次记录
  const lastTotal = user.problemNumber || 0;
  const increment = Math.max(0, total - lastTotal);

  user.ojStats = newStats; // 更新分项缓存
  user.problemNumber = total; // 更新总数
  await user.save();

  if (increment > 0) {
    const now = new Date();
    await PracticeMonthStats.findOneAndUpdate(
      { userId, year: now.getFullYear(), month: now.getMonth() + 1 },
      { $inc: { problemCount: increment } }, // 使用 $inc 原子增加，防止并发覆盖
      { upsert: true }
    );
  }

  // 7. 记日志
  await CrawlerLog.create({
    userId,
    triggerType,
    details: newStats, // 记录详细分项
    totalSolved: total,
    increment: increment,
    errors: errors.length > 0 ? errors.join('; ') : undefined // 记录报错以便排查
  });

  console.log(`[Crawler] ${user.realName} 更新完成。Total: ${total} (+${increment})。Warnings: ${errors.length}`);

  return { 
    previous: lastTotal, 
    current: total, 
    increment,
    details: newStats,
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