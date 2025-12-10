// src/services/config.service.ts
import GlobalSetting from '../models/global-setting.model';

// --- 内存缓存 ---
// 默认值，防止数据库没初始化时报错
let CACHED_SEASON = '2025-2026'; 

// 1. 初始化配置 (在 app.ts 启动时调用)
export const initGlobalConfig = async () => {
  try {
    const setting = await GlobalSetting.findOne({ key: 'CURRENT_SEASON' });
    if (setting) {
      CACHED_SEASON = setting.value as string;
      console.log(`[Config] 赛季配置已加载: ${CACHED_SEASON}`);
    } else {
      // 如果数据库里没有，初始化一条
      console.log(`[Config] 未找到赛季配置，正在初始化默认值...`);
      await GlobalSetting.create({
        key: 'CURRENT_SEASON',
        value: CACHED_SEASON,
        description: '当前生效的竞赛赛季'
      });
    }
  } catch (error) {
    console.error('[Config] 加载配置失败:', error);
  }
};

// 2. 获取当前赛季 (同步方法，直接返回内存值，极快)
export const getCurrentSeason = (): string => {
  return CACHED_SEASON;
};

// 3. 更新赛季 (管理员调用)
export const updateCurrentSeason = async (newSeason: string) => {
  // 更新数据库
  await GlobalSetting.findOneAndUpdate(
    { key: 'CURRENT_SEASON' },
    { value: newSeason },
    { upsert: true, new: true }
  );
  
  // 更新内存缓存
  CACHED_SEASON = newSeason;
  console.log(`[Config] 赛季已更新为: ${newSeason}`);
  return CACHED_SEASON;
};
