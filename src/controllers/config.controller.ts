import { Request, Response } from 'express';
import { getCurrentSeason, updateCurrentSeason } from '../services/config.service';
import { success, fail } from '../utils/response';
import MonthlySnapshot from '../models/monthly-snapshot.model'
import User from '../models/user.model';
import * as ratingService from '../services/rating.service';
import { archiveAndResetSeason } from '../services/rating.service';
import GlobalSetting from '../models/global-setting.model';
import { getIntegrationKey } from '../services/integration-keys.service';

export const getIntegrationKeys = async (_req: Request, res: Response) => {
  try {
    const [association, vp] = await Promise.all([getIntegrationKey('CWNUPAA_APP_KEY'), getIntegrationKey('VP_HISTORY_API_KEY')]);
    success(res, { associationConfigured: Boolean(association), vpHistoryConfigured: Boolean(vp) });
  } catch { fail(res, '数据接入配置暂时无法读取', 500, 500); }
};
export const setIntegrationKey = async (req: Request, res: Response) => {
  const keyName = req.body?.service === 'association' ? 'CWNUPAA_APP_KEY'
    : req.body?.service === 'vp-history' ? 'VP_HISTORY_API_KEY' : '';
  if (!keyName) return fail(res, '请选择有效的数据接入服务', 400, 400);
  const key = req.body?.apiKey;
  if (typeof key !== 'string' || key.trim().length < 20 || key.length > 512 || /\s/.test(key.trim())) {
    return fail(res, '请输入有效的服务密钥', 400, 400);
  }
  try {
    await GlobalSetting.findOneAndUpdate({ key: keyName }, { $set: {
      value: key.trim(), description: '系统管理保存的服务密钥，仅供后端调用',
    } }, { upsert: true });
    success(res, { configured: true }, '服务密钥已保存');
  } catch { fail(res, '数据接入配置保存失败', 500, 500); }
};

// 获取当前赛季
export const getSeason = (req: Request, res: Response) => {
  success(res, { season: getCurrentSeason() });
};

// 修改赛季 (危险操作)
export const setSeason = async (req: Request, res: Response) => {
  try {
    const { season: newSeason } = req.body;
    
    if (!newSeason || !/^\d{4}-\d{4}$/.test(newSeason)) {
      return fail(res, '赛季格式不正确');
    }

    const oldSeason = getCurrentSeason();

    if (oldSeason === newSeason) {
      return success(res, { season: oldSeason }, '无需切换');
    }

    console.warn(`[System] 正在将赛季从 ${oldSeason} 切换至 ${newSeason}...`);

    // 传入 newSeason
    await archiveAndResetSeason(oldSeason, newSeason);
    await ratingService.markContestRecordsArchivedBySeason(oldSeason);

    // 更新全局配置
    await updateCurrentSeason(newSeason);
    
    success(res, { season: newSeason }, `成功切换赛季！`);

  } catch (error: any) {
    console.error(error);
    fail(res, error.message || '赛季切换失败', 500);
  }
};

// 设置 AtCoder Cookie
export const setAtCoderCookie = async (req: Request, res: Response) => {
  const { cookieValue } = req.body
  if (!cookieValue) {
    return fail(res, 'Cookie value is required', 400);
  }
  await GlobalSetting.findOneAndUpdate(
    { key: 'atcoder_cookie' },
    { 
      value: cookieValue,
      description: 'AtCoder Session Cookie (REVEL_SESSION)'
    },
    { upsert: true, new: true }
  );

  return success(res, null, 'AtCoder Cookie updated successfully!')
}

export const getAtCoderCookie = async (req: Request, res: Response) => {
  const config = await GlobalSetting.findOne({ key: 'atcoder_cookie' });
  return success(res, { configured: Boolean(config?.value) });
}

export const initSnapshots = async (req: Request, res: Response) => {
  const now = new Date();
  const users = await User.find({ role: { $ne: 'Teacher' } });
  let count = 0;
  
  for (const user of users) {
    await MonthlySnapshot.create({
      userId: user._id,
      season: getCurrentSeason(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      totalSolved: user.problemNumber
    });
    count++;
  }
  success(res, count, '快照初始化完成');
};

// [调试用] 强制触发上月结算
export const forceSettle = async (req: Request, res: Response) => {
  try {
    const count = await ratingService.batchSettleLastMonth();
    success(res, { count }, '强制结算成功');
  } catch (error: any) {
    fail(res, error.message);
  }
};

export const recalculateRatings = async (_req: Request, res: Response) => {
  try {
    const count = await ratingService.recalculateAllUserRatings();
    success(res, { count }, 'Rating 重算成功');
  } catch (error: any) {
    fail(res, error.message || 'Rating 重算失败', 500);
  }
};
