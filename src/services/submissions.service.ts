import User from "../models/user.model";
import Submission from "../models/submission.model";
import { crawlLuogu } from "../utils/crawlers/luogu";
import { crawlCodeForces } from "../utils/crawlers/codeforces";
import { crawlAtCoder } from "../utils/crawlers/atcoder";
import { crawlNowCoder } from "../utils/crawlers/nowcoder";
import { ObjectId } from "mongoose";
import { AtCoderCookieExpiredError } from "../utils/errors";

export const syncUserSubmissions = async (
  userId: string,
  client_id: string,
) => {
  const user = await User.findById(userId);
  if (!user || !user.ojInfo) return;

  const tasks = [];

  if (user.ojInfo.cf) {
    tasks.push(
      crawlCodeForces(user.ojInfo.cf).catch((e) =>
        console.error("CF crawl failed", e),
      ),
    );
  }
  if (user.ojInfo.lg) {
    if (client_id) {
      tasks.push(
        crawlLuogu(user.ojInfo.lg, client_id).catch((e) =>
          console.error("Luogu crawl failed", e),
        ),
      );
    } else {
      console.log("跳过洛谷，无 client_id");
    }
  }
  if (user.ojInfo.at) {
    tasks.push(
      crawlAtCoder(user.ojInfo.at).catch((e) =>
        console.error("AtCoder crawl failed", e),
      ),
    );
  }
  if (user.ojInfo.nc) {
    tasks.push(
      crawlNowCoder(user.ojInfo.nc).catch((e) =>
        console.error("NowCoder crawl failed", e),
      ),
    );
  }

  const results = await Promise.all(tasks);
  const flatResults = results.flat().filter(Boolean);

  // 🟢 内存去重：只保留每道题最早的一次 AC
  const uniqueMap = new Map<string, any>(); // Key: "Platform_ProblemId"

  for (const sub of flatResults) {
    // 生成一个临时的唯一Key，比如 "CodeForces_1850A"
    const uniqueKey = `${sub.platform}_${sub.problemId}`;

    if (!uniqueMap.has(uniqueKey)) {
      uniqueMap.set(uniqueKey, sub);
    } else {
      // 如果已经存在，比较时间，保留更早的那个
      const existing = uniqueMap.get(uniqueKey);
      if (new Date(sub.solveTime) < new Date(existing.solveTime)) {
        uniqueMap.set(uniqueKey, sub);
      }
    }
  }
  // 提取去重后的列表
  const uniqueSubmissions = Array.from(uniqueMap.values());

  // 批量写入数据库
  let newCount = 0;
  for (const sub of uniqueSubmissions) {
    const exists = await Submission.findOne({
      userId: user._id,
      platform: sub.platform,
      problemId: sub.problemId,
    });

    if (!exists) {
      await Submission.create({ ...sub, userId: user._id });
      newCount++;
    } else {
      if (new Date(sub.solveTime) < exists.solveTime) {
        await Submission.findByIdAndUpdate(exists._id, {
          ...sub,
          userId: user._id,
        });
      }
    }
  }

  console.log(
    `Synced ${uniqueSubmissions.length} unique records, ${newCount} new.`,
  );

  // 🟢 核心修改：返回统计数据
  return {
    new: newCount, // 本次新增入库数
    platforms: tasks.length, // 涉及平台数
  };
};

// 同步 cf
export const getCodeForces = async (username: string, userId: ObjectId) => {
  try {
    const results = await crawlCodeForces(username);
    const flatResults = results.flat().filter(Boolean);

    // 🟢 内存去重：只保留每道题最早的一次 AC
    const uniqueMap = new Map<string, any>(); // Key: "Platform_ProblemId"

    for (const sub of flatResults) {
      // 生成一个临时的唯一Key，比如 "CodeForces_1850A"
      const uniqueKey = `${sub.platform}_${sub.problemId}`;

      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, sub);
      } else {
        // 如果已经存在，比较时间，保留更早的那个
        const existing = uniqueMap.get(uniqueKey);
        if (new Date(sub.solveTime) < new Date(existing.solveTime)) {
          uniqueMap.set(uniqueKey, sub);
        }
      }
    }
    // 提取去重后的列表
    const uniqueSubmissions = Array.from(uniqueMap.values());

    // 批量写入数据库
    let newCount = 0;
    for (const sub of uniqueSubmissions) {
      const exists = await Submission.findOne({
        userId: userId,
        platform: sub.platform,
        problemId: sub.problemId,
      });

      if (!exists) {
        await Submission.create({ ...sub, userId: userId });
        newCount++;
      } else {
        if (new Date(sub.solveTime) < exists.solveTime) {
          await Submission.findByIdAndUpdate(exists._id, {
            ...sub,
            userId: userId,
          });
        }
      }
    }

    console.log(
      `Synced ${uniqueSubmissions.length} unique records, ${newCount} new.`,
    );

    // 🟢 核心修改：返回统计数据
    return {
      new: newCount, // 本次新增入库数
    };
  } catch (e) {
    console.log(e);
  }
};

// 同步 at
export const getAtCoder = async (username: string, userId: ObjectId) => {
  try {
    const results = await crawlAtCoder(username);
    const flatResults = results.flat().filter(Boolean);

    // 🟢 内存去重：只保留每道题最早的一次 AC
    const uniqueMap = new Map<string, any>(); // Key: "Platform_ProblemId"

    for (const sub of flatResults) {
      // 生成一个临时的唯一Key，比如 "CodeForces_1850A"
      const uniqueKey = `${sub.platform}_${sub.problemId}`;

      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, sub);
      } else {
        // 如果已经存在，比较时间，保留更早的那个
        const existing = uniqueMap.get(uniqueKey);
        if (new Date(sub.solveTime) < new Date(existing.solveTime)) {
          uniqueMap.set(uniqueKey, sub);
        }
      }
    }
    // 提取去重后的列表
    const uniqueSubmissions = Array.from(uniqueMap.values());

    // 批量写入数据库
    let newCount = 0;
    for (const sub of uniqueSubmissions) {
      const exists = await Submission.findOne({
        userId: userId,
        platform: sub.platform,
        problemId: sub.problemId,
      });

      if (!exists) {
        await Submission.create({ ...sub, userId: userId });
        newCount++;
      } else {
        if (new Date(sub.solveTime) < exists.solveTime) {
          await Submission.findByIdAndUpdate(exists._id, {
            ...sub,
            userId: userId,
          });
        }
      }
    }

    console.log(
      `Synced ${uniqueSubmissions.length} unique records, ${newCount} new.`,
    );

    // 🟢 核心修改：返回统计数据
    return {
      new: newCount,
    };
  } catch (e) {
    if (e instanceof AtCoderCookieExpiredError) {
      throw e;
    }
    console.log(e);
  }
};

// 同步 lg
export const getLuogu = async (
  username: string,
  userId: ObjectId,
  client_id: string,
) => {
  try {
    const results = await crawlLuogu(username, client_id);
    const flatResults = results.flat().filter(Boolean);

    // 🟢 内存去重：只保留每道题最早的一次 AC
    const uniqueMap = new Map<string, any>(); // Key: "Platform_ProblemId"

    for (const sub of flatResults) {
      // 生成一个临时的唯一Key，比如 "CodeForces_1850A"
      const uniqueKey = `${sub.platform}_${sub.problemId}`;

      if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, sub);
      } else {
        // 如果已经存在，比较时间，保留更早的那个
        const existing = uniqueMap.get(uniqueKey);
        if (new Date(sub.solveTime) < new Date(existing.solveTime)) {
          uniqueMap.set(uniqueKey, sub);
        }
      }
    }
    // 提取去重后的列表
    const uniqueSubmissions = Array.from(uniqueMap.values());

    // 批量写入数据库
    let newCount = 0;
    for (const sub of uniqueSubmissions) {
      const exists = await Submission.findOne({
        userId: userId,
        platform: sub.platform,
        problemId: sub.problemId,
      });

      if (!exists) {
        await Submission.create({ ...sub, userId: userId });
        newCount++;
      } else {
        if (new Date(sub.solveTime) < exists.solveTime) {
          await Submission.findByIdAndUpdate(exists._id, {
            ...sub,
            userId: userId,
          });
        }
      }
    }

    console.log(
      `Synced ${uniqueSubmissions.length} unique records, ${newCount} new.`,
    );

    // 🟢 核心修改：返回统计数据
    return {
      new: newCount,
    };
  } catch (e) {
    console.log(e);
  }
};

// 同步 nc
export const getNowCoder = async (username: string, userId: ObjectId) => {
  try {
    const results = await crawlNowCoder(username)
    const flatResults = results.flat().filter(Boolean);

    // 🟢 内存去重：只保留每道题最早的一次 AC
    const uniqueMap = new Map<string, any>(); // Key: "Platform_ProblemId"

    for (const sub of flatResults) {
        // 生成一个临时的唯一Key，比如 "CodeForces_1850A"
        const uniqueKey = `${sub.platform}_${sub.problemId}`;
        
        if (!uniqueMap.has(uniqueKey)) {
        uniqueMap.set(uniqueKey, sub);
        } else {
        // 如果已经存在，比较时间，保留更早的那个
        const existing = uniqueMap.get(uniqueKey);
        if (new Date(sub.solveTime) < new Date(existing.solveTime)) {
            uniqueMap.set(uniqueKey, sub);
        }
        }
    }
    // 提取去重后的列表
    const uniqueSubmissions = Array.from(uniqueMap.values());

    // 批量写入数据库
    let newCount = 0;
    let updatedCount = 0;

    for (const sub of uniqueSubmissions) {
        const exists = await Submission.findOne({
            userId: userId,
            platform: sub.platform,
            problemId: sub.problemId
        });

        if (!exists) {
            await Submission.create({ ...sub, userId: userId });
            newCount++;
        } else {
            // 构建需要更新的字段
            const updates: any = {};
            let needsUpdate = false;

            // 1. 如果新爬到的时间比数据库里存的还早，更新时间和链接
            if (new Date(sub.solveTime) < exists.solveTime) {
                updates.solveTime = sub.solveTime;
                updates.remoteId = sub.remoteId;
                updates.link = sub.link;
                needsUpdate = true;
            }

            // 2. 关键修复：更新难度信息
            // 如果爬虫获取到了难度 (sub.difficulty > 0) 
            // 且 (数据库里没有难度 或 数据库里的难度与新数据不一致)，则执行更新
            if (sub.difficulty > 0 && (!exists.difficulty || exists.difficulty !== sub.difficulty)) {
                 updates.difficulty = sub.difficulty;
                 updates.rawDifficulty = sub.rawDifficulty;
                 needsUpdate = true;
            }

            // 执行更新操作
            if (needsUpdate) {
                await Submission.updateOne({ _id: exists._id }, { $set: updates });
                updatedCount++;
            }
        }
    }
    
    console.log(`Synced ${uniqueSubmissions.length} unique records. Created: ${newCount}, Updated: ${updatedCount}.`);

    // 🟢 核心修改：返回统计数据
    return {
        new: newCount,
    };
  } catch (e) {
    console.log(e);
  }
}