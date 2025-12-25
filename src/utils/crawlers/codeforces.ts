import axios from "axios";
import { normalizeDifficulty } from "./index";

export const crawlCodeForces = async (handle: string) => {
    try {
        const res = await axios.get(`https://codeforces.com/api/user.status?handle=${handle}`);
        if (res.data.status !== 'OK') {
            return []
        }

        // 1. 过滤出 AC 的提交
        const acceptedSubmissions = res.data.result.filter((sub: any) => sub.verdict === 'OK');

        // 2. 🟢 关键：按提交时间升序排序 (creationTimeSeconds 越小越早)
        // 确保我们优先处理的是该用户最早的 AC 记录
        acceptedSubmissions.sort((a: any, b: any) => a.creationTimeSeconds - b.creationTimeSeconds);

        // 3. 🟢 关键：去重逻辑
        const uniqueSubmissions: any[] = [];
        const seenProblemIds = new Set<string>();

        for (const sub of acceptedSubmissions) {
            // 构造唯一的题目标识符 (例如: CF1850A)
            const pid = `CF${sub.problem.contestId}${sub.problem.index}`;

            // 如果这个题目之前没出现过，说明这是最早的一条 AC
            if (!seenProblemIds.has(pid)) {
                seenProblemIds.add(pid);
                uniqueSubmissions.push(sub);
            }
            // 如果出现过，说明是重复刷题（或者后续更晚的提交），直接忽略
        }

        // 4. 映射数据格式
        return uniqueSubmissions.map((sub: any) => ({
            platform: 'CodeForces',
            remoteId: sub.id.toString(),
            // 确保这里生成的 ID 和去重时使用的逻辑一致
            problemId: `CF${sub.problem.contestId}${sub.problem.index}`,
            title: sub.problem.name,
            link: `https://codeforces.com/${sub.problem.contestId <= 10000 ? 'contest' : 'gym'}/${sub.problem.contestId}/problem/${sub.problem.index}`, // [cite: 3]
            solveTime: new Date(sub.creationTimeSeconds * 1000),
            rawDifficulty: sub.problem.rating?.toString() || 'N/A',
            difficulty: normalizeDifficulty('CodeForces', sub.problem.rating),
            tags: sub.problem.tags
        }));

    } catch (error) {
        console.error(`CodeForces crawl error for ${handle}:`, error); // 修正了这里的报错文案
        return [];
    }
};