import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';

export interface RawContestData {
  name: string;
  platform: string;
  link: string;
  startTime: Date;
  uniqueId: string; // 用 平台+ID 做唯一标识
}

// 1. 爬 Codeforces
const fetchCodeforces = async (): Promise<RawContestData[]> => {
  try {
    const { data } = await axios.get('https://codeforces.com/api/contest.list?gym=false', { timeout: 10000 });
    if (data.status !== 'OK') return [];

    return data.result
      .filter((c: any) => c.phase === 'BEFORE') // 未开始的
      .map((c: any) => ({
        name: c.name,
        platform: 'CodeForces',
        link: `https://codeforces.com/contests/${c.id}`,
        startTime: new Date(c.startTimeSeconds * 1000),
        uniqueId: `CF_${c.id}`
      }));
  } catch (e) {
    console.error('[Crawler] CF failed:', e);
    return [];
  }
};

// 2. 爬 AtCoder
const fetchAtCoder = async (): Promise<RawContestData[]> => {
  try {
    const { data } = await axios.get('https://atcoder.jp/contests', { timeout: 10000 });
    const $ = cheerio.load(data);
    const list: RawContestData[] = [];

    $('#contest-table-upcoming tbody tr').each((_, el) => {
      const tds = $(el).find('td');
      if (tds.length === 0) return;

      const timeStr = $(tds[0]).find('a').text();
      const linkPath = $(tds[1]).find('a').attr('href');
      const name = $(tds[1]).find('a').text();
      const contestId = linkPath?.split('/').pop();

      list.push({
        name,
        platform: 'AtCoder',
        link: `https://atcoder.jp${linkPath}`,
        startTime: new Date(timeStr), // 依赖服务器时区或 dayjs 解析
        uniqueId: `AT_${contestId}`
      });
    });
    return list;
  } catch (e) {
    console.error('[Crawler] AtCoder failed:', e);
    return [];
  }
};

// 3. 爬牛客 (NowCoder)
const fetchNowCoder = async (): Promise<RawContestData[]> => {
  try {
    // ⚠️ 必须带 User-Agent
    const agent = new https.Agent({
        keepAlive: true,
        rejectUnauthorized: false, // 忽略 SSL 报错
        family: 4 // 🔴 强制使用 IPv4 (解决部分云服务器 IPv6 解析超时问题)
    });
    const { data } = await axios.get('https://ac.nowcoder.com/acm/contest/vip-index', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Referer': 'https://ac.nowcoder.com/',
        'Host': 'ac.nowcoder.com', 
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive'
      },
      timeout: 30000,
      httpsAgent: agent
    });
    
    const $ = cheerio.load(data);
    const list: RawContestData[] = [];

    // 🟢 根据提供的 HTML结构，遍历 .platform-item-cont
    $('.platform-item-cont').each((_, el) => {
      const $el = $(el);
      
      // 1. 获取标题和链接 (h4 > a)
      const $link = $el.find('h4 a').first();
      const name = $link.text().trim();
      const relativeLink = $link.attr('href');
      
      // 2. 获取时间 (.match-time-icon)
      // 文本示例: "比赛时间：    2025-12-26 19:00 \n 至..."
      const timeText = $el.find('.match-time-icon').text().trim();
      
      // 正则提取 YYYY-MM-DD HH:mm (允许中间有多个空格)
      const timeMatch = timeText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
      
      if (name && relativeLink && timeMatch) {
        // 清理时间字符串中的多余空格 (如 "2025-12-26   19:00" -> "2025-12-26 19:00")
        const cleanTimeStr = timeMatch[0].replace(/\s+/, ' ');
        const startTime = new Date(cleanTimeStr);
        const contestId = relativeLink.split('/').pop(); // 提取 ID (如 125955)
        
        // 过滤掉已经开始或结束的比赛
        if (startTime > new Date()) {
          list.push({
            name,
            platform: 'NowCoder',
            link: `https://ac.nowcoder.com${relativeLink}`,
            startTime,
            uniqueId: `NC_${contestId}`
          });
        }
      }
    });

    return list;
  } catch (e) {
    console.error('[Crawler] NowCoder failed:', e instanceof Error ? e.message : e);
    return [];
  }
};

export const fetchAllUpcoming = async () => {
  const [cf, at, nc] = await Promise.all([fetchCodeforces(), fetchAtCoder(), fetchNowCoder()]);

  const all = [...cf, ...at, ...nc];
  // 按时间升序排序 (最近的在前)
  return all.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};