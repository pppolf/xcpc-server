import mongoose, { Schema, Document } from 'mongoose';

export interface ITicket extends Document {
  userId: mongoose.Types.ObjectId;
  type: string;       // 比赛类型 (XCPC_REGIONAL, LANQIAO...)
  season: string;     // 赛季
  contestName: string; // 比赛名称
  awardLevel?: string; // 奖项等级 (可选)
  rank?: number;       // 排名 (可选)
  totalParticipants?: number; // 总人数 (可选)
  proofUrl: string;   // 凭证图片URL
  description?: string; // 备注
  status: 'Pending' | 'Approved' | 'Rejected';
  adminComment?: string; // 管理员驳回理由
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  season: { type: String, required: true },
  contestName: { type: String, required: true },
  awardLevel: { type: String }, 
  rank: { type: Number },
  totalParticipants: { type: Number },
  proofUrl: { type: String }, // 前端上传到图床后的链接
  description: { type: String },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  adminComment: { type: String }
}, { timestamps: true });

export default mongoose.model<ITicket>('Ticket', TicketSchema);