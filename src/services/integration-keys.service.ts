import GlobalSetting from '../models/global-setting.model';

export type IntegrationKeyName = 'CWNUPAA_APP_KEY' | 'VP_HISTORY_API_KEY';
export const getIntegrationKey = async (key: IntegrationKeyName) => {
  const setting = await GlobalSetting.findOne({ key }).lean();
  // System management is authoritative; environment values support the upgrade.
  if (typeof setting?.value === 'string' && setting.value.trim()) return setting.value.trim();
  return process.env[key]?.trim() || '';
};
export const initIntegrationKeys = async () => {
  for (const key of ['CWNUPAA_APP_KEY', 'VP_HISTORY_API_KEY'] as const) {
    const value = process.env[key]?.trim();
    if (value)
      await GlobalSetting.findOneAndUpdate(
        { key },
        {
          $setOnInsert: {
            value,
            description:
              key === 'CWNUPAA_APP_KEY'
                ? '协会官网外部登录 appKey，仅供后端使用'
                : 'VP System 历史数据只读 API Key',
          },
        },
        { upsert: true },
      );
  }
};
