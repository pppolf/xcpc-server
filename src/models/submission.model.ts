import mongoose, { Schema, Document } from 'mongoose';

export interface ISubmission extends Document {
  userId: mongoose.Types.ObjectId;
  platform: 'CodeForces' | 'AtCoder' | 'Luogu' | 'NowCoder' | 'CWNUOJ';
  remoteId: string; // 提交记录的ID (RunID)，用于跳转链接
  problemId: string; // 题目ID (如 1800A)，用于去重
  title: string;
  link: string;
  solveTime: Date;
  difficulty: number;
  rawDifficulty: string;
  tags: string[];
}

const SubmissionSchema = new Schema<ISubmission>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, required: true },
  
  remoteId: { type: String, required: true }, 
  problemId: { type: String, required: true },
  
  title: { type: String },
  link: { type: String },
  solveTime: { type: Date, required: true },
  difficulty: { type: Number, default: 0 },
  rawDifficulty: { type: String },
  tags: [String]
}, { timestamps: true });

// 唯一索引组合改为 userId + platform + problemId
// 这样同一个用户在同一个平台，同一道题只能存一条数据
SubmissionSchema.index({ userId: 1, platform: 1, problemId: 1 }, { unique: true });

// 辅助索引
SubmissionSchema.index({ userId: 1, solveTime: -1 });

export default mongoose.model<ISubmission>('Submission', SubmissionSchema);