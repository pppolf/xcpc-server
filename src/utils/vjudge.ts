import axios from 'axios';
import User from '../models/user.model';
import { getTrainingTargetCount } from './training-target';

// 模拟请求 Vjudge 数据的函数
// 注意：Vjudge 可能有反爬虫，生产环境可能需要代理或 Cookie
export const fetchVjudgeRank = async (contestId: string) => {
  // 这里的 URL 是 Vjudge 的公开 API
  const url = `https://vjudge.net/contest/rank/single/${contestId}`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  });
  return res.data;
};

// 解析逻辑
export const parseAndSyncRank = async (trainingDoc: any) => {
  const activeUsers = await User.find({ 
    status: 'Active', 
    role: { $ne: 'Teacher' } 
  });

  // 1. 获取原始数据
  const rawData = await fetchVjudgeRank(trainingDoc.vjudgeContestId);
  
  // 2. 准备数据
  const participants = rawData.participants; // { "id": [handle, name...] }
  const submissions = rawData.submissions;   // [ [userId, problemIdx, status, time], ... ]
  
  // 3. 提取所有参与者的 Handle
  const vjudgeIdMap = new Map<number, string>(); // vjudgeUserId -> handle
  const allHandles: string[] = [];
  
  const vjudgeIdToHandleMap = new Map<number, string>();
  for (const key in participants) {
    // participants[key][0] 是 handle (用户名)
    // 统一转小写比较，防止大小写差异导致匹配失败
    vjudgeIdToHandleMap.set(Number(key), participants[key][0].toLowerCase());
  }
  const vjudgeStatsMap = new Map<string, any>();

  for (const key in participants) {
    const handle = participants[key][0]; // 获取 handle
    vjudgeIdMap.set(Number(key), handle);
    allHandles.push(handle);
  }

  // 遍历提交
  // sub: [userId, problemIndex, isStatus, time]
  // isStatus: 1=AC, 0=Fail
  submissions.forEach((sub: any[]) => {
    const [vid, pIdx, status, time] = sub;
    const handle = vjudgeIdToHandleMap.get(vid);
    if (!handle) return;
    if (!vjudgeStatsMap.has(handle)) {
      vjudgeStatsMap.set(handle, {
        solved: 0,
        penalty: 0,
        problemStatus: {}
      });
    }
    const stats = vjudgeStatsMap.get(handle);
    if (status === 1) {
      const key = String(pIdx);
      // 如果这题之前没 AC 过，才计算
      if (!stats.problemStatus[key]) {
        stats.problemStatus[key] = { accepted: true, time };
        stats.solved++;
        stats.penalty += time; // 累加罚时
      }
    }
    
  });

  // 6. 转换为数组并计算达标情况
  // 5. 🟢 核心改变：遍历本地所有在役队员，匹配成绩
  const newRanklist = activeUsers.map(user => {
    // 获取用户的 vjudgeHandle (转小写匹配)
    const userHandle = user.ojInfo.vjudge ? user.ojInfo.vjudge.toLowerCase() : '';
    
    // 尝试去 Vjudge 的统计结果里找
    const stats = vjudgeStatsMap.get(userHandle);

    let solved = 0;
    let penalty = 0;
    let problemStatus = {};

    if (stats) {
      // 找到了：该队员参加了比赛
      solved = stats.solved;
      penalty = stats.penalty;
      problemStatus = stats.problemStatus;
    } else {
      // 没找到：该队员缺席，或者没填 Vjudge 账号
      // 保持默认 0
    }

    const targetCount = getTrainingTargetCount(trainingDoc, user);

    return {
      userId: user._id,
      realName: user.realName,
      trainingTeam: user.trainingTeam,
      targetCount,
      vjudgeHandle: user.ojInfo.vjudge, // 显示原始 handle
      solved: solved,
      penalty: penalty,
      isAK: solved >= trainingDoc.problemCount,
      isPassed: solved >= targetCount,
      problemStatus: problemStatus
    };
  });

  if (rawData.begin) {
    trainingDoc.startTime = new Date(rawData.begin);
    trainingDoc.duration = Math.floor(rawData.length / 1000);
  }

  trainingDoc.ranklist = newRanklist;
  
  // 显式标记混合类型字段已修改
  trainingDoc.markModified('ranklist');
  
  await trainingDoc.save();
  return trainingDoc;
};
