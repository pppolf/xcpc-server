// src/models/crawler-log.model.ts
import mongoose from 'mongoose';

const CrawlerLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // 触发方式: 'AUTO'(定时任务), 'MANUAL'(管理员手动)
  triggerType: { type: String, default: 'MANUAL' }, 
  
  // 这一刻爬取到的各个平台数据（快照）
  details: {
    codeforces: { type: Number, default: 0 },
    atcoder:    { type: Number, default: 0 },
    nowcoder:   { type: Number, default: 0 },
    luogu:      { type: Number, default: 0 },
    cwnuoj:     { type: Number, default: 0 }
  },

  errors: { type: String, default: '' },
  
  // 这一刻的总题数
  totalSolved: { type: Number, required: true },
  
  // 核心：相比上一次记录，增加了多少题 (Delta)
  increment: { type: Number, required: true },
  
  createdAt: { type: Date, default: Date.now } // 刷新时间
});

// 索引：按用户和时间倒序查询，为了快速找到"上一次"记录
CrawlerLogSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('CrawlerLog', CrawlerLogSchema);