import axios from 'axios';
import { normalizeDifficulty } from './index';
import Submission from '../../models/submission.model';

// 基础 Header
const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Referer': 'https://www.luogu.com.cn/',
  'Cookie': '__client_id=f80bad386706022ba644fcccf6ebfd6825060576;_uid=984056', 
  'x-requested-with': 'XMLHttpRequest',
  'Connection': 'keep-alive'
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getLuoguUid = async (keyword: string): Promise<string | null> => {
  try {
    const searchUrl = `https://www.luogu.com.cn/api/user/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await axios.get(searchUrl, {
      // API 请求需要这个头
      headers: { ...BASE_HEADERS, 'x-requested-with': 'XMLHttpRequest' },
      timeout: 5000
    });
    if (res.data?.users?.length > 0) return res.data.users[0].uid.toString();
    return null;
  } catch (e) { return null; }
};

export const crawlLuogu = async (username: string, client_id: string) => {
  const uid = await getLuoguUid(username);
  if (!uid) {
    console.error(`Luogu user ${username} not found`);
    return [];
  }

  const results: any[] = [];
  let page = 1;
  let shouldStop = false;

  try {
    while (!shouldStop) {
      const url = `https://www.luogu.com.cn/record/list?user=${uid}&status=12&page=${page}`;
      console.log('url: ', url);
      // 页面请求，只用 Base Headers
      const res = await axios.get(url, { headers: {...BASE_HEADERS, 'Cookie': `__client_id=${client_id};_uid=${uid}`,}, timeout: 8000 });
      const html = res.data;

      // 🟢 核心正则：匹配 window._feInjection
      const match = html.match(/decodeURIComponent\("([^"]+)"\)/);
      
      if (!match || !match[1]) {
        console.warn(`Luogu crawler: Failed to parse data on page ${page}.`);
        // 调试：如果失败，可能是被拦截了，打印前100个字符看看是不是 403 页面
        console.log('Response preview:', html.substring(0, 100)); 
        break; 
      }

      const jsonStr = decodeURIComponent(match[1]);
      const data = JSON.parse(jsonStr);

      
      const records = data.currentData?.records?.result || [];
      
      if (records.length === 0) {
        break; 
      }

      for (const record of records) {
        const remoteId = record.id.toString();
        
        // 检查数据库
        const exists = await Submission.exists({ platform: 'Luogu', remoteId: remoteId });
        if (exists) {
          shouldStop = true;
          break; 
        }

        // 解析难度
        const diff = record.problem.difficulty;
        
        results.push({
          platform: 'Luogu',
          remoteId: remoteId,
          // 洛谷的 problemId 就是 pid (如 P1001)
          problemId: record.problem.pid, 
          title: record.problem.title,
          link: `https://www.luogu.com.cn/problem/${record.problem.pid}`,
          solveTime: new Date(record.submitTime * 1000),
          rawDifficulty: diff.toString(),
          difficulty: normalizeDifficulty('Luogu', diff),
          tags: []
        });
      }

      page++;
      await sleep(2000); // 稍微慢一点，避免触发验证码
    }
  } catch (error: any) {
    console.error(`Luogu crawl error for ${username}:`, error.message);
    if (error.response?.status === 403) {
      console.error('🔴 403 Forbidden: 请检查 Cookie 中的 __client_id 是否过期');
    }
  }
  // 1. 按时间升序排序 (最早的排前面)
  results.sort((a, b) => a.solveTime.getTime() - b.solveTime.getTime());

  // 2. 按题目ID去重 (保留最早的一个)
  const uniqueResults: any[] = [];
  const seenProblemIds = new Set<string>();

  for (const sub of results) {
    if (!seenProblemIds.has(sub.problemId)) {
      seenProblemIds.add(sub.problemId);
      uniqueResults.push(sub);
    }
  }

  return uniqueResults;
};