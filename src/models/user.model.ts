import mongoose, { Schema, Document } from 'mongoose';

// 1. 定义接口 (Interface)
export interface IUser extends Document {
  username: string;
  password?: string;
  realName: string;
  gender: string;
  college: string;
  professional: string;
  grade: string;
  studentId: string;
  phone: string;
  idCard: string;
  email: string;
  tsize: string;
  avatar: string;
  role: string;
  status: string;
  ojInfo: {
    cf: string;
    at: string;
    nc: string;
    lg: string;
    cwnuoj: string;
  };
  problemNumber: number;
  rating: number;
  ratingInfo: {
    contest: number;          // 比赛分 (R_contest)
    problem: number;          // 刷题分 (R_problem)
    legacy: number;           // 历史衰减分 (R_legacy)
    activeCoefficient: number; // 当前活跃系数 (K_active)，前端展示给队员看
  };
}

// 2. 定义 Schema
const UserSchema: Schema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false }, // select: false 默认不查密码
    realName: { type: String, required: true },
    gender: { type: String, required: true },
    college: { type: String, required: true },
    professional: { type: String, required: true },
    grade: { type: String, required: true },
    studentId: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    idCard: { type: String, required: true },
    email: { type: String, required: true },
    tsize: { type: String, required: true },
    avatar: { type: String, default: '',},
    role: { type: String, default: 'Member' },
    status: { type: String, default: 'Active' },
    ojInfo: {
      cf: { type: String, default: '' },
      at: { type: String, default: '' },
      nc: { type: String, default: '' },
      lg: { type: String, default: '' },
      cwnuoj: { type: String, default: '' },
    },
    problemNumber: { type: Number, default: 0 },
    rating: { type: Number, default: 0, index: -1 },
    ratingInfo: {
      contest: { type: Number, default: 0 },
      problem: { type: Number, default: 0 },
      legacy: { type: Number, default: 0 },
      activeCoefficient: { type: Number, default: 1.0 } // 默认为 1.0
    }
  },
  { timestamps: true }
);

// 3. 导出模型
export default mongoose.model<IUser>('User', UserSchema);