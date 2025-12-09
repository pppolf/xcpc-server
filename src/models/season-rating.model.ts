// src/models/season-rating.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ISeasonRating extends Document {
  userId: mongoose.Types.ObjectId;
  season: string;        // 赛季名 (如 2023-2024)
  finalRating: number;   // 赛季结束时的总分
  contestScore: number;  // 当时的比赛分
  practiceScore: number; // 当时的刷题分
  rank: number;          // 当时全队排名
  createdAt: Date;
}

const SeasonRatingSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  season: { type: String, required: true },
  finalRating: { type: Number, default: 0 },
  contestScore: { type: Number, default: 0 },
  practiceScore: { type: Number, default: 0 },
  rank: { type: Number, default: 0 } // 记录排名，方便做历史回顾
}, { timestamps: true });

// 复合唯一索引：一个人在一个赛季只有一条归档记录
SeasonRatingSchema.index({ userId: 1, season: 1 }, { unique: true });

export default mongoose.model<ISeasonRating>('SeasonRating', SeasonRatingSchema);