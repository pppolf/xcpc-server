import mongoose from 'mongoose';

const PracticeMonthStatsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  season: { type: String, required: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true }, // 1-12
  
  problemCount: { type: Number, default: 0 }, // P_month
  activeCoefficient: { type: Number, default: 1.0 }, // K_active (结算时的系数)
  
  monthScore: { type: Number, default: 0 }, // 当月最终得分 (min(T, P) * 0.5 * K)
  isSettled: { type: Boolean, default: false } // 是否已结算
});

export default mongoose.model('PracticeMonthStats', PracticeMonthStatsSchema);