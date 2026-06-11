import axios from "axios";
import User from "../models/user.model";
import { getTrainingTargetCount } from "./training-target";

const NOWCODER_TEAM_ID = process.env.NOWCODER_TEAM_ID || "726142122";

type ProblemStatus = {
  accepted: boolean;
  time: number;
  score?: number;
  fullScore?: number;
};

type ProblemStatusMap = Record<string, ProblemStatus>;

const toNumber = (value: any, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeKey = (value: any) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const nearlyEqual = (a: any, b: any) => {
  const left = Number(a);
  const right = Number(b);
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) < 1e-6
  );
};

const normalizeNowCoderTime = (value: any) => {
  const num = toNumber(value);
  return num > 100000 ? Math.floor(num / 1000) : num;
};

export const fetchNowCoderRank = async (contestId: string) => {
  const url =
    "https://ac.nowcoder.com/acm-heavy/acm/contest/real-time-rank-data";
  const res = await axios.get(url, {
    params: {
      token: "",
      id: contestId,
      teamId: NOWCODER_TEAM_ID,
      limit: 0,
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      Referer: `https://ac.nowcoder.com/acm/contest/${contestId}`,
    },
    timeout: 30000,
  });
  return res.data;
};

const getByPath = (obj: any, path: string[]) => {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
};

const getUid = (row: any) => {
  return (
    row?.uid ??
    row?.userId ??
    row?.user_id ??
    row?.user?.uid ??
    row?.user?.userId ??
    row?.member?.uid ??
    row?.member?.userId
  );
};

const findRankRows = (payload: any): any[] => {
  const directPaths = [
    ["data", "rankData"],
    ["data", "rankList"],
    ["data", "list"],
    ["data", "rows"],
    ["data", "data"],
    ["rankData"],
    ["rankList"],
    ["list"],
    ["rows"],
  ];

  for (const path of directPaths) {
    const value = getByPath(payload, path);
    if (
      Array.isArray(value) &&
      value.some((item) => item && typeof item === "object")
    ) {
      return value;
    }
  }

  const candidates: any[][] = [];
  const visit = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      if (
        value.some((item) => item && typeof item === "object" && getUid(item))
      ) {
        candidates.push(value);
      }
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };

  visit(payload);
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || [];
};

const getSolved = (row: any) => {
  return toNumber(
    row?.solved ??
      row?.acceptedCount ??
      row?.acCount ??
      row?.acceptedProblemCount ??
      row?.passedProblemCount ??
      row?.passCount ??
      row?.accepted ??
      row?.ac,
  );
};

const getPenalty = (row: any) => {
  return normalizeNowCoderTime(
    row?.penalty ??
      row?.penaltyTime ??
      row?.totalPenalty ??
      row?.time ??
      row?.useTime,
  );
};

const isProblemCollectionKey = (key: string) => {
  return /problem|submit|submission|ac|accept|pass|solve|rankData/i.test(key);
};

const isAcceptedOnlyKey = (key: string) => {
  return /accepted|accept|ac|passed|pass|solved|solve/i.test(key);
};

const getProblemCollection = (row: any) => {
  return (
    row?.problemStatus ??
    row?.problems ??
    row?.problemData ??
    row?.problemList ??
    row?.scoreList ??
    row?.submissions ??
    row?.submitInfo ??
    row?.submissionInfo ??
    row?.problemResult ??
    row?.acceptedProblemInfo ??
    row?.acceptedSubmitProblemInfo ??
    row?.acProblemInfo
  );
};

const isAcceptedProblem = (problem: any) => {
  if (typeof problem === "boolean") return problem;
  if (typeof problem === "number") return problem > 0;
  if (typeof problem === "string") {
    return [
      "1",
      "2",
      "ac",
      "accepted",
      "pass",
      "passed",
      "solved",
      "yes",
      "true",
    ].includes(problem.trim().toLowerCase());
  }

  const status =
    problem?.status ??
    problem?.result ??
    problem?.judgeStatus ??
    problem?.accepted ??
    problem?.state ??
    problem?.resultType;
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();

  return (
    problem?.accepted === true ||
    problem?.isAccepted === true ||
    problem?.ac === true ||
    problem?.pass === true ||
    problem?.passed === true ||
    problem?.solved === true ||
    problem?.success === true ||
    status === 1 ||
    status === 2 ||
    [
      "1",
      "2",
      "ac",
      "accepted",
      "pass",
      "passed",
      "solved",
      "yes",
      "true",
    ].includes(normalized)
  );
};

const getProblemTime = (problem: any) => {
  if (typeof problem === "number") return problem;
  return normalizeNowCoderTime(
    problem?.time ??
      problem?.acceptedTime ??
      problem?.acTime ??
      problem?.firstAcceptTime ??
      problem?.firstAcTime ??
      problem?.reachTime ??
      problem?.submitTime ??
      problem?.useTime ??
      problem?.costTime,
  );
};

const getProblemScore = (problem: any) => {
  return Math.max(
    toNumber(problem?.score),
    toNumber(problem?.postContestScore),
  );
};

const getProblemKey = (problem: any, fallbackKey: any) => {
  return (
    problem?.index ??
    problem?.problemIndex ??
    problem?.problemNo ??
    problem?.problemNoStr ??
    problem?.problemId ??
    problem?.pid ??
    problem?.id ??
    problem?.letter ??
    problem?.label ??
    problem?.name ??
    fallbackKey
  );
};

const labelToZeroBasedIndex = (label: string) => {
  const value = label.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(value)) return undefined;

  let result = 0;
  for (const char of value) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result - 1;
};

const setProblemStatus = (
  statusMap: ProblemStatusMap,
  key: any,
  status: ProblemStatus,
  fallbackIndex?: number,
) => {
  if (key !== undefined && key !== null && key !== "") {
    const rawKey = String(key);
    statusMap[rawKey] = status;

    const numericKey = Number(rawKey);
    if (
      Number.isInteger(numericKey) &&
      numericKey > 0 &&
      fallbackIndex !== undefined &&
      numericKey === fallbackIndex + 1
    ) {
      statusMap[String(numericKey - 1)] = status;
    }

    const labelIndex = labelToZeroBasedIndex(rawKey);
    if (labelIndex !== undefined) {
      statusMap[String(labelIndex)] = status;
    }
  }

  if (fallbackIndex !== undefined) {
    statusMap[String(fallbackIndex)] = status;
  }
};

const setAcceptedProblem = (
  statusMap: ProblemStatusMap,
  key: any,
  time: number,
  fallbackIndex?: number,
) => {
  setProblemStatus(statusMap, key, { accepted: true, time }, fallbackIndex);
};

const getProblemDefinitions = (payload: any): any[] => {
  const directPaths = [
    ["data", "problemData"],
    ["problemData"],
    ["data", "problems"],
    ["problems"],
    ["data", "problemList"],
    ["problemList"],
  ];

  for (const path of directPaths) {
    const value = getByPath(payload, path);
    if (Array.isArray(value)) return value;
  }

  return [];
};

const getProblemFullScore = (
  problem: any,
  definitions: any[],
  index: number,
) => {
  const byIndex = definitions[index];
  const byProblemId = definitions.find(
    (item) => item?.problemId === problem?.problemId,
  );
  return (
    byProblemId?.score ??
    byProblemId?.sorce ??
    byProblemId?.fullScore ??
    byIndex?.score ??
    byIndex?.sorce ??
    byIndex?.fullScore ??
    problem?.fullScore
  );
};

const parseScoreListStatus = (row: any, definitions: any[]) => {
  const statusMap: ProblemStatusMap = {};
  if (!Array.isArray(row?.scoreList)) return statusMap;

  row.scoreList.forEach((problem: any, index: number) => {
    const fullScore = getProblemFullScore(problem, definitions, index);
    const score = getProblemScore(problem);
    const accepted = nearlyEqual(score, fullScore);
    setProblemStatus(
      statusMap,
      getProblemKey(problem, index),
      {
        accepted,
        time: getProblemTime(problem),
        score,
        fullScore: toNumber(fullScore),
      },
      index,
    );
  });

  return statusMap;
};

const getSolvedFromProblemStatus = (problemStatus: ProblemStatusMap) => {
  return new Set(
    Object.values(problemStatus).filter((status) => status?.accepted),
  ).size;
};

const parseProblemStatus = (row: any, definitions: any[]) => {
  const scoreListStatus = parseScoreListStatus(row, definitions);
  if (Object.keys(scoreListStatus).length > 0) {
    return scoreListStatus;
  }

  const statusMap: ProblemStatusMap = {};

  const parseSource = (
    value: any,
    acceptedOnly = false,
    depth = 0,
    sourceKey = "",
  ) => {
    if (!value || depth > 5) return;

    if (Array.isArray(value)) {
      value.forEach((problem, index) => {
        if (acceptedOnly || isAcceptedProblem(problem)) {
          setAcceptedProblem(
            statusMap,
            getProblemKey(problem, index),
            getProblemTime(problem),
            index,
          );
          return;
        }

        if (problem && typeof problem === "object") {
          Object.entries(problem).forEach(([key, child]) => {
            if (isProblemCollectionKey(key)) {
              parseSource(child, isAcceptedOnlyKey(key), depth + 1, key);
            }
          });
        }
      });
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([key, problem]) => {
        if (
          acceptedOnly ||
          isAcceptedOnlyKey(sourceKey) ||
          isAcceptedProblem(problem)
        ) {
          setAcceptedProblem(
            statusMap,
            getProblemKey(problem, key),
            getProblemTime(problem),
          );
          return;
        }

        if (problem && typeof problem === "object") {
          Object.entries(problem).forEach(([childKey, child]) => {
            if (isProblemCollectionKey(childKey)) {
              parseSource(
                child,
                isAcceptedOnlyKey(childKey),
                depth + 1,
                childKey,
              );
            }
          });
        }
      });
    }
  };

  parseSource(getProblemCollection(row));

  if (Object.keys(statusMap).length === 0) {
    Object.entries(row || {}).forEach(([key, value]) => {
      if (isProblemCollectionKey(key)) {
        parseSource(value, isAcceptedOnlyKey(key), 0, key);
      }
    });
  }

  return statusMap;
};

export const parseAndSyncNowCoderRank = async (trainingDoc: any) => {
  const activeUsers = await User.find({
    status: "Active",
    role: { $ne: "Teacher" },
  });

  const contestId =
    trainingDoc.nowcoderContestId || trainingDoc.vjudgeContestId;
  if (!contestId) {
    throw new Error("缺少牛客比赛 ID");
  }

  const rawData = await fetchNowCoderRank(contestId);
  const rows = findRankRows(rawData);
  const problemDefinitions = getProblemDefinitions(rawData);
  const statsMap = new Map<string, any>();

  rows.forEach((row) => {
    const uid = normalizeKey(getUid(row));
    if (!uid) return;
    const problemStatus = parseProblemStatus(row, problemDefinitions);
    statsMap.set(uid, {
      solved: getSolvedFromProblemStatus(problemStatus) || getSolved(row),
      penalty: getPenalty(row),
      problemStatus,
    });
  });

  const newRanklist = activeUsers.map((user) => {
    const nowcoderId = normalizeKey(user.ojInfo?.nc);
    const stats = statsMap.get(nowcoderId);
    const solved = stats?.solved || 0;
    const penalty = stats?.penalty || 0;
    const problemStatus = stats?.problemStatus || {};
    const targetCount = getTrainingTargetCount(trainingDoc, user);

    return {
      userId: user._id,
      realName: user.realName,
      trainingTeam: user.trainingTeam,
      targetCount,
      vjudgeHandle: user.ojInfo?.nc || "",
      solved,
      penalty,
      isAK: solved >= trainingDoc.problemCount,
      isPassed: solved >= targetCount,
      problemStatus,
    };
  });

  trainingDoc.ranklist = newRanklist;
  trainingDoc.markModified("ranklist");
  await trainingDoc.save();
  return trainingDoc;
};
