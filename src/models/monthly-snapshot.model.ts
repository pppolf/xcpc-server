// src/models/monthly-snapshot.model.ts
import mongoose from 'mongoose';

const MonthlySnapshotSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  season: { type: String, required: true }, // 方便查询赛季
  
  year: { type: Number, required: true },
  month: { type: Number, required: true }, // 记录这是"几月份"的月初快照
  
  totalSolved: { type: Number, required: true }, // 这一刻的总题数 (绝对值)
  
  createdAt: { type: Date, default: Date.now }
});

// 唯一索引：一个人一个月只能有一个月初快照
MonthlySnapshotSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

export default mongoose.model('MonthlySnapshot', MonthlySnapshotSchema);