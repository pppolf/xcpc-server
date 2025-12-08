// src/models/global-setting.model.ts
import mongoose from 'mongoose';

const GlobalSettingSchema = new mongoose.Schema({
  // 配置键，如 'CURRENT_SEASON'
  key: { type: String, required: true, unique: true },
  // 配置值，如 '2023-2024'
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  // 描述，给管理员看的
  description: { type: String }
});

export default mongoose.model('GlobalSetting', GlobalSettingSchema);