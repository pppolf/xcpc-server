import mongoose, { Schema, Document } from 'mongoose';

export interface ITraining extends Document {
  title: string;
  type: 'TRAINING' | 'ASSESSMENT';
  practiceUrl?: string | null;
  termId?: string | null; // Scoring semester, independent of the event date. Null is legacy data only.
  problemSetterIds: mongoose.Types.ObjectId[];
  platform: 'VJUDGE' | 'NOWCODER' | 'CWNUOJ' | 'ASSOCIATION_BOARD' | 'VP_SYSTEM' | 'LOCAL' | 'OTHER';
  vpContestUrl?: string;
  vpProblems?: string[];
  vpIncludePractice?: boolean;
  vpFrozen?: boolean;
  vjudgeContestId?: string;
  nowcoderContestId?: string;
  cwnuojContestId?: string;
  cwnuojContestUrl?: string;
  cwnuojProblemIds?: number[];
  associationBoardId?: string;
  associationBoardUrl?: string;
  associationBoardProblems?: { id: string; name: string; score: number }[];
  associationBoardType?: string;
  associationBoardScope?: 'team' | 'personal';
  associationBoardFrozen?: boolean;
  lastSyncedAt?: Date;
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
    termId: { type: String, default: null },
    practiceUrl: { type: String, default: null },
    problemSetterIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    platform: { type: String, enum: ['VJUDGE', 'NOWCODER', 'CWNUOJ', 'ASSOCIATION_BOARD', 'VP_SYSTEM', 'LOCAL', 'OTHER'], default: 'VJUDGE' },
    vpContestUrl: String,
    vpProblems: [String],
    vpIncludePractice: { type: Boolean, default: false },
    vpFrozen: Boolean,
    vjudgeContestId: { type: String },
    nowcoderContestId: { type: String },
    cwnuojContestId: String,
    cwnuojContestUrl: String,
    cwnuojProblemIds: [Number],
    associationBoardId: String,
    associationBoardUrl: String,
    associationBoardProblems: [{ _id: false, id: String, name: String, score: Number }],
    associationBoardType: String,
    associationBoardScope: { type: String, enum: ['team', 'personal'] },
    associationBoardFrozen: Boolean,
    lastSyncedAt: Date,

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
        cwnuojUid: String,
        associationUserId: String,
        associationAccount: String,
        resultScope: { type: String, enum: ['team', 'personal'] },
        sourceName: String,
        sourceRank: Number,
        sourceScore: Number,
        vpRecordId: String,
        vpRank: String,
        vpPoints: Number,
        vpHistoryCount: Number,
        vpContestSolved: Number,
        nowcoderContestSolved: Number,
        vpPracticeSolved: Number,
        vpStartedAt: Date,
        syncStatus: { type: String, enum: ['synced', 'unbound', 'invalid-id', 'not-participating', 'ambiguous', 'vp-unbound'] },
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
