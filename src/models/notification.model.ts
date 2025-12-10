import mongoose, { Schema } from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // 接收人
    title: { type: String, required: true },   // 标题 (e.g. "审核通过")
    content: { type: String, required: true }, // 内容 (e.g. "您的ICPC济南站申请已通过")
    type: { type: String, enum: ['success', 'warning', 'info', 'error'], default: 'info' }, // 类型决定图标颜色
    isRead: { type: Boolean, default: false }, // 是否已读
    relatedId: { type: Schema.Types.ObjectId, ref: 'Ticket', }, // 可选：关联的工单ID，方便点击跳转
  },
  { timestamps: true }
);

export default mongoose.model('Notification', notificationSchema);