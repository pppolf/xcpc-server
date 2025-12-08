import mongoose from 'mongoose';

const SeasonRatingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  season: { type: String, required: true }, // e.g., "2022-2023"
  finalRating: { type: Number, required: true }, // 该赛季结束时的总分
  order: { type: Number, required: true } // 赛季序号，方便排序计算距离 k
});

export default mongoose.model('SeasonRating', SeasonRatingSchema);
