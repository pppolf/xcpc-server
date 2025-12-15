import mongoose, { Schema } from 'mongoose';

export interface ITraining extends Document {
  title: string;
  type: 'TRAINING' | 'ASSESSMENT'; // 训练 | 考核
  platform: 'VJUDGE' | 'LOCAL';
  vjudgeContestId?: string; // Vjudge 比赛 ID
  problemCount: number; // 题目数量
  targetCount: number;  // 目标过题数
  startTime: Date;
  duration: number; // 秒
  ranklist: any[]; // 存储榜单快照
}

const TrainingSchema = new mongoose.Schema({
  title: { type: String, required: true }, // 训练标题
  type: { type: String, enum: ['TRAINING', 'ASSESSMENT'], default: 'TRAINING' }, // 训练赛 vs 考核赛
  
  // 平台来源
  platform: { type: String, enum: ['VJUDGE', 'LOCAL', 'OTHER'], default: 'VJUDGE' },
  vjudgeContestId: { type: String }, // 如果是 Vjudge，存比赛ID (如 769279)
  
  // 目标设定
  problemCount: { type: Number, required: true }, // 总题数 X
  targetCount: { type: Number, required: true },  // 达标题数 Y
  
  // 时间控制 (用于进度条)
  startTime: { type: Date, required: true },
  duration: { type: Number, required: true }, // 单位：秒 (Vjudge API 返回的是秒) (length)
  
  // 成绩快照 (核心)
  ranklist: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 关联本地用户
    vjudgeHandle: String, // 冗余存一下，方便核对
    realName: String,     // 冗余存一下，减少联查
    solved: { type: Number, default: 0 }, // 过题数
    penalty: { type: Number, default: 0 }, // 罚时（秒）
    isAK: { type: Boolean, default: false }, // 是否全部完成
    isPassed: { type: Boolean, default: false }, // 是否达标
    // 题目详情: index -> { accepted: boolean, time: number }
    problemStatus: { type: Schema.Types.Mixed, default: {} }  
  }]
}, { timestamps: true });

export default mongoose.model<ITraining>('Training', TrainingSchema);