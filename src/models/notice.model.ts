import mongoose, { Schema, Document } from 'mongoose';
import Counter from './counter.model'; // 引入刚才写的计数器

// 1. 定义附件的接口结构
interface IAttachment {
  name: string; // 文件名 (例如: 比赛名单.xlsx)
  url: string;  // 下载地址 (例如: /uploads/attachments/170xxx.xlsx)
  size?: number; // 文件大小 (字节)，可选，方便前端显示大小
  type?: string; // 文件类型 (MimeType)，可选，方便前端显示图标
}

export interface INotice extends Document {
  nid: number;          // 自增ID (1, 2, 3...)
  title: string;
  content: string;      // Markdown 源码
  author: mongoose.Types.ObjectId;
  authorName: string;   // 冗余存一个名字，方便列表页直接显示，不用关联查询
  status: 'DRAFT' | 'PUBLISHED';
  isTop: boolean;
  views: number;
  attachments: IAttachment[];
}

const NoticeSchema = new Schema<INotice>({
  nid: { type: Number, unique: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  
  // 关联用户表，但也存个名字方便显示
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String }, 

  status: { 
    type: String, 
    enum: ['DRAFT', 'PUBLISHED'], 
    default: 'PUBLISHED' 
  },
  
  isTop: { type: Boolean, default: false },
  views: { type: Number, default: 0 },
  attachments: [
    {
      name: { type: String, required: true },
      url:  { type: String, required: true },
      size: { type: Number },
      type: { type: String }
    }
  ]
}, { timestamps: true });

// 核心魔法：在保存前自动生成 nid
NoticeSchema.pre('save', async function() {
  if (this.isNew) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'notice_id' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      if (counter) {
        this.nid = counter.seq;
      }
    } catch (error: any) {
      throw new Error(error);
    }
  }
});

export default mongoose.model<INotice>('Notice', NoticeSchema);