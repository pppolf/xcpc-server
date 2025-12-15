import { Request, Response } from 'express';
import Training from '../models/training.model';
import { parseAndSyncRank } from '../utils/vjudge';
import { success, fail } from '../utils/response';
import User from '../models/user.model';

// 获取列表
export const getTrainings = async (req: Request, res: Response) => {
  try {
    const list = await Training.find().sort({ startTime: -1 });
    success(res, list);
  } catch (e: any) { fail(res, e.message); }
};

// 获取详情
export const getTrainingDetail = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id).lean();
    if (!training) return fail(res, '训练不存在');
    success(res, training);
  } catch (e: any) { fail(res, e.message); }
};

// 创建训练
export const createTraining = async (req: Request, res: Response) => {
  try {
    const training = await Training.create(req.body) as any;
    // 如果是 Vjudge，创建后立即尝试同步一次
    if (training.platform === 'VJUDGE' && training.vjudgeContestId) {
      try {
        await parseAndSyncRank(training);
      } catch (err) {
        console.error('初始同步失败，请手动刷新', err);
      }
    }
    success(res, training);
  } catch (e: any) { fail(res, e.message); }
};

// 手动刷新数据 (同步 Vjudge)
export const refreshTraining = async (req: Request, res: Response) => {
  try {
    const training = await Training.findById(req.params.id);
    if (!training) return fail(res, '未找到记录');
    
    if (training.platform === 'VJUDGE') {
      const updated = await parseAndSyncRank(training);
      return success(res, updated);
    }
    
    success(res, training);
  } catch (e: any) { fail(res, e.message); }
};

// 删除
export const deleteTraining = async (req: Request, res: Response) => {
  await Training.findByIdAndDelete(req.params.id);
  success(res, '已删除');
};

export const updateTraining = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // 使用 { new: true } 返回修改后的数据
    const training = await Training.findByIdAndUpdate(id, req.body, { new: true });
    
    if (!training) return fail(res, '记录不存在');
    
    // 如果修改了 Vjudge ID，可能需要提示用户重新同步，这里暂不自动同步，以免误操作
    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};


// 🟢 [新增] 导入成绩 (解析 Excel 粘贴的文本)
export const importTrainingData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content } = req.body; // 粘贴的文本内容

    const training = await Training.findById(id);
    if (!training) return fail(res, '训练不存在');

    // 1. 获取所有“在役”队员 (假设 status: 'Active')
    // 如果你的状态字段不一样（比如是 inService），请修改这里
    const activeMembers = await User.find({ role: {$ne: 'Teacher'}, status: { $eq: 'Active'} });

    // 2. 解析文本内容
    // 格式：姓名 <Tab> 过题数 <Tab> [学号]
    const scoreMap = new Map<string, number>(); // Key: 学号 或 姓名, Value: 过题数

    if (content) {
      const lines = content.split('\n');
      lines.forEach((line: string) => {
        const parts = line.trim().split(/\t+|\s+/); // 按 Tab 或 空格分割
        if (parts.length < 2) return;

        const name = parts[0];
        const solved = parseInt(parts[1]) || 0;
        const studentId = parts[2]; // 可选

        // 优先使用学号匹配，如果没有学号则使用姓名
        if (studentId) {
          scoreMap.set(studentId, solved);
        } else {
          scoreMap.set(name, solved);
        }
      });
    }

    // 3. 构建 Ranklist (包含所有在役队员)
    const newRanklist = activeMembers.map(user => {
      // 尝试匹配成绩
      // 先找学号，再找真实姓名
      let solved = 0;
      if (scoreMap.has(user.studentId)) {
        solved = scoreMap.get(user.studentId) || 0;
      } else if (scoreMap.has(user.realName)) {
        solved = scoreMap.get(user.realName) || 0;
      }

      return {
        userId: user._id,
        realName: user.realName,
        // 这里借用 vjudgeHandle 字段存学号，或者你也可以在 Schema 里加个 studentId 字段
        // 为了不改 Schema，我们暂时把学号存在 vjudgeHandle 里，或者前端展示时直接用 user 对象
        vjudgeHandle: user.studentId, 
        solved: solved,
        isAK: solved >= training.problemCount,
        isPassed: solved >= training.targetCount,
        problemStatus: {} // 手动导入没有题目详情
      };
    });

    // 4. 保存
    training.ranklist = newRanklist;
    training.markModified('ranklist');
    await training.save();

    success(res, training);
  } catch (e: any) {
    fail(res, e.message);
  }
};