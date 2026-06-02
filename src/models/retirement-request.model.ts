import mongoose, { Schema, Document } from 'mongoose';

export type RetirementRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface IRetirementRequest extends Document {
  userId: mongoose.Types.ObjectId;
  reason: string;
  contact?: string;
  status: RetirementRequestStatus;
  adminComment?: string;
  handledBy?: mongoose.Types.ObjectId;
  handledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RetirementRequestSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true },
    contact: { type: String, trim: true },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    adminComment: { type: String, trim: true },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    handledAt: { type: Date },
  },
  { timestamps: true },
);

RetirementRequestSchema.index({ userId: 1, status: 1 });

export default mongoose.model<IRetirementRequest>('RetirementRequest', RetirementRequestSchema);
