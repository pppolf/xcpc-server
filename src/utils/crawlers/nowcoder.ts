import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { normalizeDifficulty } from "./index";
import Submission from "../../models/submission.model"; // 引入模型用于查重

// --- 缓存相关配置 ---
const CACHE_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "nowcoder_difficulty.json");

// 确保 data 目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 内存中的难度缓存 Map<string(numberId), number(difficulty)>
let difficultyCache: Record<string, number> = {};

// 加载缓存
const loadCache = () => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      difficultyCache = JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load NowCoder difficulty cache:", error);
    difficultyCache = {};
  }
};

// 保存缓存 (每次爬取结束后调用一次即可)
const saveCache = () => {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(difficultyCache, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Failed to save NowCoder difficulty cache:", error);
  }
};

// 初始化加载
loadCache();

// 通用 Headers
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  Host: "ac.nowcoder.com",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 获取单个题目难度
 * 优先查本地缓存，没有则查 API
 */
const getProblemDifficulty = async (
  numericId: string,
  forceUpdate = false,
): Promise<number> => {
  // 1. 查缓存
  if (difficultyCache[numericId] !== undefined && !forceUpdate) {
    return difficultyCache[numericId];
  }

  // 2. 查 API
  try {
    await sleep(500); // 稍微限流，防止查询太快
    const apiUrl = `https://ac.nowcoder.com/acm/problem/list/json?keyword=${numericId}&asc=true`;
    const res = await axios.get(apiUrl, {
      headers: { ...COMMON_HEADERS, Host: "ac.nowcoder.com" },
      timeout: 5000,
    });

    // 解析返回结构
    // {"data": {"problemSets": [{"difficulty": 3000, ...}]}}
    if (res.data?.code === 0 && res.data?.data?.problemSets?.length > 0) {
      // 遍历找到完全匹配 problemId 的项 (防止 keyword 模糊搜索搜出一堆)
      const targetProblem = res.data.data.problemSets.find(
        (p: any) => String(p.problemId) === numericId,
      );

      if (targetProblem) {
        const diff =
          targetProblem.difficulty < 9
            ? normalizeDifficulty("Luogu", targetProblem.difficulty)
            : targetProblem.difficulty; // 兼容洛谷的特殊难度分
        difficultyCache[numericId] = diff; // 更新内存缓存
        return diff;
      }
    }

    // 如果没找到或 API 结构不对，存一个 0 防止重复查询无效 ID
    difficultyCache[numericId] = 0;
    return 0;
  } catch (error) {
    console.warn(
      `Failed to fetch difficulty for NowCoder ID ${numericId}:`,
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
};

export const crawlNowCoder = async (userId: string) => {
  const results: any[] = [];
  let page = 1;
  let shouldStop = false;
  let lastPageSignature = "";

  // 牛客的用户 ID 通常是数字，如果传入的不是数字，可能需要报错或跳过
  if (!/^\d+$/.test(userId)) {
    console.warn(`NowCoder userId should be numeric, got: ${userId}`);
    // 如果支持用户名转ID，这里需要额外的逻辑，但通常牛客直接填数字ID
  }

  try {
    const agent = new https.Agent({
      rejectUnauthorized: false,
      family: 4, // 🔴 关键：强制 IPv4，解决云服务器超时问题
      keepAlive: true,
    });

    while (!shouldStop) {
      //  构建 URL
      // statusTypeFilter=5: 代表 "答案正确" (Accepted)
      // orderType=DESC: 按时间倒序，这对我们的“遇到已存在即停止”优化至关重要
      // pageSize=200: 尽量一页多拿点
      const url = `https://ac.nowcoder.com/acm/contest/profile/${userId}/practice-coding?pageSize=200&statusTypeFilter=5&orderType=DESC&page=${page}`;

      const res = await axios.get(url, {
        headers: {
          ...COMMON_HEADERS,
          Referer: `https://ac.nowcoder.com/acm/contest/profile/${userId}/practice-coding`,
          Connection: "keep-alive",
        },
        timeout: 30000,
        httpsAgent: agent,
      });
      const $ = cheerio.load(res.data);

      // 解析表格行
      // 牛客练习榜单的表格类名通常是 table-hover
      const rows = $("table.table-hover tbody tr");

      if (rows.length === 0) {
        break; // 没有数据了，停止
      }
      const currentSignature = rows.first().html() || "";

      if (currentSignature === lastPageSignature) {
        break;
      }

      lastPageSignature = currentSignature;

      for (const el of rows) {
        const $el = $(el);
        const tds = $el.find("td");

        // 预防空行
        if (tds.length < 1) continue;

        // --- 1. 解析题目信息 (通常在第2列，索引1) ---
        const $titleLink = tds.eq(1).find("a");
        const title = $titleLink.text().trim();
        const href = $titleLink.attr("href") || "";

        // 提取题目 ID
        // 链接示例: /acm/problem/14325
        const problemIdMatch = href.match(/\/problem\/(\d+)/);
        // 如果是比赛题目可能格式不同，这里主要针对题库题目
        const numericId = problemIdMatch ? problemIdMatch[1] : null;
        const problemId = problemIdMatch
          ? `NC${problemIdMatch[1]}`
          : `NC_${title}`;

        // --- 2. 解析提交时间 (通常在第5列，索引4) ---
        // 格式示例: 2023-12-24 10:00:00
        const timeStr = tds.eq(8).text().trim();

        // --- 3. 构造 RemoteId ---
        const remoteId = tds.eq(0).text().trim();

        // 🟢 核心优化：检查数据库是否已存在该记录
        // 只要数据库里有了这道题，且由于我们是按时间倒序爬取的
        // 说明这道题（以及更早的题）都已经入库了，可以直接停止
        // const exists = await Submission.exists({
        //   platform: 'NowCoder',
        //   remoteId: remoteId
        // });

        // if (exists) {
        //   shouldStop = true;
        //   break;
        // }

        if (title && timeStr) {
          results.push({
            platform: "NowCoder",
            remoteId: remoteId,
            problemId: problemId,
            numericId: numericId,
            title: title,
            link: `https://ac.nowcoder.com${href}`,
            solveTime: new Date(timeStr),
            rawDifficulty: "N/A",
            difficulty: 0,
            tags: [],
          });
        }
      }

      // 翻页逻辑
      page++;
      await sleep(1000); // 礼貌爬虫
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

  // 3. 批量获取难度 (仅对去重后的结果操作，极大减少请求量)
  let cacheUpdated = false;
  console.log(
    `[NowCoder] Post-processing difficulty for ${uniqueResults.length} problems...`,
  );

  for (const sub of uniqueResults) {
    if (sub.numericId) {
      // 获取原始难度(牛客 API 返回值)
      const rawDiff = await getProblemDifficulty(sub.numericId);

      // 更新结果对象
      if (rawDiff > 0) {
        sub.rawDifficulty = rawDiff.toString();
        // 假设 normalizeDifficulty 接受由牛客定义的难度分
        sub.difficulty = normalizeDifficulty("NowCoder", rawDiff);
        cacheUpdated = true;
      }
    }
    // 移除过程中的临时字段
    delete sub.numericId;
  }

  if (uniqueResults.length > 0) {
    saveCache();
  }

  return uniqueResults;
};

export const refreshNowCoderDifficultyCache = async () => {
  console.log("Starting scheduled NowCoder difficulty cache refresh...");
  loadCache();

  const keys = Object.keys(difficultyCache);
  let updatedCount = 0;

  console.log(`[NowCoder Cache] Checking ${keys.length} cached problems...`);

  // 遍历缓存，重试那些之前获取失败 (value 为 0) 的题目
  // 也可以选择全量刷新，但考虑到 API 限制，建议只修补或分批
  for (const id of keys) {
    // 策略：只针对记录为 0 (未找到/失败) 的题目尝试重新获取
    // 这样可以每天自动修复新的或者之前超时的题目
    if (difficultyCache[id] === 0) {
      const newDiff = await getProblemDifficulty(id, true);
      if (newDiff !== 0) {
        updatedCount++;
        console.log(
          `[NowCoder Cache] Fixed difficulty for problem ${id}: ${newDiff}`,
        );
      }
    }
  }

  if (updatedCount > 0) {
    saveCache();
    console.log(`[NowCoder Cache] Saved. Updated ${updatedCount} problems.`);
  } else {
    console.log("[NowCoder Cache] No changes needed.");
  }

  console.log("Scheduled refresh completed.");
};
