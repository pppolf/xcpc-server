import mongoose from 'mongoose';

const ContestRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true }, // e.g. "第14届蓝桥杯"
  season: { type: String, required: true }, // e.g. "2022-2023"
  
  // 比赛/奖项大类: 'XCPC_REGIONAL', 'GPLT', 'LANQIAO', 'ASTAR'...
  type: { type: String, required: true }, 
  
  // 核心修改：增加具体奖项等级
  // 对于常规比赛，此字段为空
  // 对于奖项，存: 'NAT_1', 'PROV_2', 'TOP' 等
  awardLevel: { type: String, default: null },

  // 常规比赛参数 (奖项类可填 0)
  totalParticipants: { type: Number, default: 0 },
  rank: { type: Number, default: 0 },

  // 原始得分 (存库时计算好的)
  rawScore: { type: Number, required: true },
  
  contestDate: { type: Date, default: Date.now }
});

ContestRecordSchema.index({ userId: 1, season: 1 });

export default mongoose.model('ContestRecord', ContestRecordSchema);