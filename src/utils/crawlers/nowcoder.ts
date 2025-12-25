import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeDifficulty } from './index';
import Submission from '../../models/submission.model'; // 引入模型用于查重

// 通用 Headers，伪装成浏览器
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Host': 'ac.nowcoder.com'
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const crawlNowCoder = async (userId: string) => {
  const results: any[] = [];
  let page = 1;
  let shouldStop = false;
  let lastPageSignature = '';

  // 牛客的用户 ID 通常是数字，如果传入的不是数字，可能需要报错或跳过
  if (!/^\d+$/.test(userId)) {
    console.warn(`NowCoder userId should be numeric, got: ${userId}`);
    // 如果支持用户名转ID，这里需要额外的逻辑，但通常牛客直接填数字ID
  }

  try {
    while (!shouldStop) {
      //  构建 URL
      // statusTypeFilter=5: 代表 "答案正确" (Accepted)
      // orderType=DESC: 按时间倒序，这对我们的“遇到已存在即停止”优化至关重要
      // pageSize=200: 尽量一页多拿点
      const url = `https://ac.nowcoder.com/acm/contest/profile/${userId}/practice-coding?pageSize=200&statusTypeFilter=5&orderType=DESC&page=${page}`;
      
      
      const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 10000 });
      const $ = cheerio.load(res.data);
      
      // 解析表格行
      // 牛客练习榜单的表格类名通常是 table-hover
      const rows = $('table.table-hover tbody tr');

      if (rows.length === 0) {
        break; // 没有数据了，停止
      }
      const currentSignature = rows.first().html() || '';

      if (currentSignature === lastPageSignature) {
          break;
      }
      
      lastPageSignature = currentSignature

      for (const el of rows) {
        const $el = $(el);
        const tds = $el.find('td');

        // 预防空行
        if (tds.length < 1) continue;

        // --- 1. 解析题目信息 (通常在第2列，索引1) ---
        const $titleLink = tds.eq(1).find('a');
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';
        
        // 提取题目 ID
        // 链接示例: /acm/problem/14325
        const problemIdMatch = href.match(/\/problem\/(\d+)/);
        // 如果是比赛题目可能格式不同，这里主要针对题库题目
        const problemId = problemIdMatch ? `NC${problemIdMatch[1]}` : `NC_${title}`;

        
        // --- 2. 解析提交时间 (通常在第5列，索引4) ---
        // 格式示例: 2023-12-24 10:00:00
        const timeStr = tds.eq(8).text().trim();
        
        // --- 3. 构造 RemoteId ---
        // 牛客列表页很难获取 RunID (提交ID)，我们使用 "题目ID" 充当 RemoteId
        // 因为我们后续要去重保留第一次，所以这在逻辑上是通的
        const remoteId = tds.eq(0).text().trim(); 

        // 🟢 核心优化：检查数据库是否已存在该记录
        // 只要数据库里有了这道题，且由于我们是按时间倒序爬取的
        // 说明这道题（以及更早的题）都已经入库了，可以直接停止
        const exists = await Submission.exists({ 
          platform: 'NowCoder', 
          remoteId: remoteId
        });

        if (exists) {
          shouldStop = true;
          break;
        }

        if (title && timeStr) {
          results.push({
            platform: 'NowCoder',
            remoteId: remoteId,
            problemId: problemId,
            title: title,
            link: `https://ac.nowcoder.com${href}`,
            solveTime: new Date(timeStr),
            rawDifficulty: 'N/A', // 文档要求牛客难度 N/A
            difficulty: normalizeDifficulty('NowCoder', 0),
            tags: []
          });
        }
      }

      // 翻页逻辑
      page++;
      await sleep(1500); // 礼貌爬虫
    }
  } catch (error) {
    console.error(`NowCoder crawl error for ${userId}:`, error);
  }


  // 1. 按时间升序排序 (最早的排前面)
  // 牛客网页默认是倒序的，所以我们爬下来的是 [新, 旧...]，必须反转或排序
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