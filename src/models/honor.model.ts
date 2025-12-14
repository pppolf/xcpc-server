import mongoose, { Schema, Document } from 'mongoose';
import Counter from './counter.model';

// 附件接口 (复用)
interface IAttachment {
  name: string;
  url: string;
  size?: number;
}

export interface IHonor extends Document {
  hid: number;          // 自增ID (1, 2...)
  title: string;
  content: string;      // HTML/Markdown
  
  coverImage: string;   // 🟢 [新增] 封面图 URL
  eventDate: Date;      // 🟢 [新增] 获奖/事件发生日期 (默认当前)
  
  author: mongoose.Types.ObjectId;
  authorName: string;
  
  status: 'DRAFT' | 'PUBLISHED';
  views: number;
  attachments: IAttachment[];
}

const HonorSchema = new Schema<IHonor>({
  hid: { type: Number, unique: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  
  // 封面图 (给个默认图，或者前端控制必填)
  coverImage: { type: String, default: '' }, 
  
  eventDate: { type: Date, default: Date.now },

  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String },

  status: { 
    type: String, 
    enum: ['DRAFT', 'PUBLISHED'], 
    default: 'PUBLISHED' 
  },
  
  views: { type: Number, default: 0 },
  
  attachments: [
    {
      name: String,
      url: String,
      size: Number
    }
  ]
}, { timestamps: true });

// 🟢 自增 ID 钩子
HonorSchema.pre('save', async function() {
  if (this.isNew) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'honor_id' }, // 使用独立的计数器 key
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      if (counter) {
        this.hid = counter.seq;
      }
    } catch (error: any) {
      throw new Error(error);
    }
  }
});

export default mongoose.model<IHonor>('Honor', HonorSchema);