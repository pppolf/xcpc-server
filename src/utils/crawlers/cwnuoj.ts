import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { normalizeDifficulty } from './index';

const ORIGIN = 'https://oj.cwnupaa.com';
export const schoolOjUid = (value: unknown) => {
  const uid = typeof value === 'string' ? value.trim() : '';
  if (!/^[1-9]\d*$/.test(uid) || !Number.isSafeInteger(Number(uid)))
    throw new Error('学校 OJ 用户 ID 必须为有效的数字 UID');
  return uid;
};
const request = async (urlPath: string) => {
  try {
    const response = await axios.get(`${ORIGIN}${urlPath}`, {
      timeout: 20000,
      maxRedirects: 0,
      maxContentLength: 32 * 1024 * 1024,
      headers: { Accept: 'application/json', 'User-Agent': 'CWNUPAA-XCPC-Tracker/1.0' },
    });
    return response.data;
  } catch {
    throw new Error('学校 OJ 数据暂时无法读取，请稍后重试；原有统计已保留');
  }
};
export const fetchSchoolOjCount = async (input: string) => {
  const body = await request(`/api/stats/${schoolOjUid(input)}`);
  if (!body || body.error || body.success === false || !Number.isSafeInteger(body.data) || body.data < 0) {
    throw new Error('学校 OJ 总题数响应异常，原有统计已保留');
  }
  return body.data as number;
};

interface ProblemMetadata {
  difficulty: number;
  rawDifficulty: string;
  tags: string[];
  fetchedAt: number;
}
const CACHE_FILE = path.join(process.cwd(), 'data', 'cwnuoj-difficulty.json');
const cache = new Map<string, ProblemMetadata>();
const metadataTasks = new Map<string, Promise<ProblemMetadata>>();
try {
  if (fs.existsSync(CACHE_FILE)) {
    const stored = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    for (const [pid, data] of Object.entries(stored) as [string, ProblemMetadata][]) {
      if (
        data &&
        Number.isFinite(data.fetchedAt) &&
        Number.isFinite(data.difficulty) &&
        typeof data.rawDifficulty === 'string' &&
        Array.isArray(data.tags) &&
        data.tags.every((tag) => typeof tag === 'string')
      )
        cache.set(pid, data);
    }
  }
} catch {
  /* A metadata cache never determines which problems count as accepted. */
}
const saveCache = () => {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(cache)));
    fs.renameSync(temporary, CACHE_FILE);
  } catch {
    console.warn('[CWNUOJ] 题目难度缓存暂时无法保存');
  }
};
const getProblemMetadata = async (pid: string): Promise<ProblemMetadata> => {
  const existing = cache.get(pid);
  if (
    existing &&
    Date.now() - existing.fetchedAt < (existing.rawDifficulty === 'N/A' ? 3600000 : 7 * 86400000)
  )
    return existing;
  const pending = metadataTasks.get(pid);
  if (pending) return pending;
  const task = (async () => {
    try {
      const body = await request(`/p/${encodeURIComponent(pid)}`);
      let level: number | undefined;
      let tags: string[] = [];
      if (body && typeof body === 'object' && body.pdoc) {
        const raw = body.pdoc.difficulty;
        if (Number.isInteger(raw) && raw >= 0 && raw <= 10) level = raw;
        if (Array.isArray(body.pdoc.tag))
          tags = body.pdoc.tag.filter((tag: unknown) => typeof tag === 'string');
      } else if (typeof body === 'string') {
        const $ = cheerio.load(body);
        $('.problem__tag-item').each((_index, element) => {
          const text = $(element).text().trim();
          const match = /(?:难度|Difficulty)\s*[:：]\s*(\d+)/i.exec(text);
          if (match && Number(match[1]) <= 10) level = Number(match[1]);
        });
      }
      if (level === undefined) throw new Error('No public difficulty');
      const result = {
        difficulty: normalizeDifficulty('CWNUOJ', level),
        rawDifficulty: String(level),
        tags,
        fetchedAt: Date.now(),
      };
      cache.set(pid, result);
      return result;
    } catch {
      if (existing) return existing;
      const unknown = { difficulty: 0, rawDifficulty: 'N/A', tags: [] as string[], fetchedAt: Date.now() };
      cache.set(pid, unknown);
      return unknown;
    }
  })();
  metadataTasks.set(pid, task);
  try {
    return await task;
  } finally {
    metadataTasks.delete(pid);
  }
};

export const crawlCWNUOJ = async (input: string) => {
  const uid = schoolOjUid(input);
  const body = await request(`/api/submissions/${uid}`);
  if (
    !body ||
    body.error ||
    body.success === false ||
    !Array.isArray(body.data) ||
    body.hasMore === true ||
    body.nextPage ||
    (typeof body.total === 'number' && body.total > body.data.length)
  ) {
    throw new Error('学校 OJ 提交记录不完整，原有统计已保留');
  }
  const earliest = new Map<
    string,
    {
      platform: 'CWNUOJ';
      sourceAccount: string;
      remoteId: string;
    problemId: string;
    displayProblemId: string;
      title: string;
      link: string;
      solveTime: Date;
    }
  >();
  for (const record of body.data) {
    if (!record || typeof record !== 'object' || !Number.isInteger(record.status)) {
      throw new Error('学校 OJ 提交记录格式异常，原有统计已保留');
    }
    if (
      (record.uid !== undefined && String(record.uid) !== uid) ||
      (record.userId !== undefined && String(record.userId) !== uid)
    ) {
      throw new Error('学校 OJ 提交记录与绑定 UID 不一致，原有统计已保留');
    }
    if (record.status !== 1) continue;
    // Use the school's stable numeric pid even when a custom label is missing or renamed.
    const pid = Number.isSafeInteger(record.pid) && record.pid > 0 ? String(record.pid) : '';
    const displayProblemId = typeof record.displayPid === 'string' && record.displayPid.trim()
      ? record.displayPid.trim() : pid;
    const rid = typeof record.rid === 'string' || Number.isSafeInteger(record.rid) ? String(record.rid) : '';
    const solveTime =
      typeof record.judgeAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.judgeAt)
        ? new Date(record.judgeAt)
        : new Date(NaN);
    if (
      !pid ||
      pid.length > 100 ||
      !/^[\w.-]+$/.test(pid) ||
      pid === '.' ||
      pid === '..' ||
      !rid ||
      rid.length > 128 ||
      !/^[a-z\d_-]+$/i.test(rid) ||
      !Number.isFinite(solveTime.getTime())
    ) {
      throw new Error('学校 OJ 通过题目的编号或时间异常，原有统计已保留');
    }
    const previous = earliest.get(pid);
    if (!previous || solveTime < previous.solveTime) {
      earliest.set(pid, {
        platform: 'CWNUOJ',
        sourceAccount: uid,
        remoteId: rid,
        problemId: pid,
        displayProblemId,
        title: typeof record.title === 'string' ? record.title : pid,
        link: `${ORIGIN}/p/${encodeURIComponent(pid)}`,
        solveTime,
      });
    }
  }
  const count = await fetchSchoolOjCount(uid); // Also rejects nonexistent UIDs.
  // The deployed API returns a complete pid-deduplicated aggregate and its count.
  // The domain's nAccept counter is separate and can lag record changes/rejudges.
  if (body.count !== undefined ? !Number.isSafeInteger(body.count) || body.count !== body.data.length
    : count !== earliest.size) throw new Error('学校 OJ 返回的记录总数不完整，原有统计已保留');
  const rows = [...earliest.values()];
  const results = [];
  for (let index = 0; index < rows.length; index += 3) {
    results.push(
      ...(await Promise.all(
        rows
          .slice(index, index + 3)
          .map(async (row) => ({ ...row, ...(await getProblemMetadata(row.problemId)) })),
      )),
    );
    if (index + 3 < rows.length) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  saveCache();
  return results;
};
