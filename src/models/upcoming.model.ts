import mongoose from 'mongoose';

const UpcomingSchema = new mongoose.Schema({
  name: { type: String, required: true },
  platform: { type: String, required: true }, // 'CodeForces', 'AtCoder', 'School', etc.
  link: { type: String },
  startTime: { type: Date, required: true },
  // 🟢 核心字段：区分来源
  type: { 
    type: String, 
    enum: ['Manual', 'Crawled'], 
    default: 'Manual',
    required: true 
  },
  // 爬虫数据的唯一标识 (防止重复插入)，手动添加的可为空
  uniqueId: { type: String } 
}, { 
  timestamps: true 
});

// 建立索引，方便按时间查询
UpcomingSchema.index({ startTime: 1 });

export default mongoose.model('Upcoming', UpcomingSchema);