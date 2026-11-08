import mongoose, { Schema, Types } from 'mongoose';

export type ReviewStatus = 'scored' | 'absent' | 'excused' | 'exempt' | 'makeup' | 'invalidated';

export interface ScoreReview {
  termId: string;
  userId: Types.ObjectId;
  itemId: string;
  status: ReviewStatus;
  solved?: number;
  penalty?: number;
  note?: string;
  updatedBy: Types.ObjectId;
}

const schema = new Schema<ScoreReview>({
  termId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  itemId: { type: String, required: true },
  status: {
    type: String, required: true,
    enum: ['scored', 'absent', 'excused', 'exempt', 'makeup', 'invalidated'],
  },
  solved: Number,
  penalty: Number,
  note: String,
  updatedBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true });

schema.index({ termId: 1, itemId: 1, userId: 1 }, { unique: true });

export default mongoose.model<ScoreReview>('TermScoreReview', schema);
