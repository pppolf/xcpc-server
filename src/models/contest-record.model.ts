import mongoose from 'mongoose';

const ContestRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  season: { type: String, required: true },

  type: { type: String, required: true },
  awardLevel: { type: String, default: null },

  totalParticipants: { type: Number, default: 0 },
  rank: { type: Number, default: 0 },

  rawScore: { type: Number, required: true },
  contestDate: { type: Date, default: Date.now },

  isArchived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null },
  archivedSeason: { type: String, default: null },
});

ContestRecordSchema.index({ userId: 1, season: 1 });
ContestRecordSchema.index({ userId: 1, isArchived: 1, season: 1 });

export default mongoose.model('ContestRecord', ContestRecordSchema);
