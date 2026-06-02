import mongoose, { Schema, Document } from 'mongoose';

export interface ITraining extends Document {
  title: string;
  type: 'TRAINING' | 'ASSESSMENT';
  platform: 'VJUDGE' | 'NOWCODER' | 'LOCAL';
  vjudgeContestId?: string;
  nowcoderContestId?: string;
  problemCount: number;
  targetCount: number;
  targetCountFirst?: number;
  targetCountSecond?: number;
  startTime: Date;
  duration: number;
  ranklist: any[];
}

const TrainingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    type: { type: String, enum: ['TRAINING', 'ASSESSMENT'], default: 'TRAINING' },

    platform: { type: String, enum: ['VJUDGE', 'NOWCODER', 'LOCAL', 'OTHER'], default: 'VJUDGE' },
    vjudgeContestId: { type: String },
    nowcoderContestId: { type: String },

    problemCount: { type: Number, required: true },
    targetCount: { type: Number, required: true },
    targetCountFirst: { type: Number },
    targetCountSecond: { type: Number },

    startTime: { type: Date, required: true },
    duration: { type: Number, required: true },

    ranklist: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        vjudgeHandle: String,
        realName: String,
        trainingTeam: String,
        targetCount: { type: Number, default: 0 },
        solved: { type: Number, default: 0 },
        penalty: { type: Number, default: 0 },
        isAK: { type: Boolean, default: false },
        isPassed: { type: Boolean, default: false },
        problemStatus: { type: Schema.Types.Mixed, default: {} },
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model<ITraining>('Training', TrainingSchema);
