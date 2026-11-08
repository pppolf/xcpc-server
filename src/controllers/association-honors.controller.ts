import { Request, Response } from 'express';
import axios from 'axios';
import User from '../models/user.model';
import { success, fail } from '../utils/response';

export const getAssociationHonors = async (req: Request, res: Response) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id))) return fail(res, '队员 ID 不正确', 400, 400);
  try {
    const user = await User.findById(req.params.id).select('studentId associationIdentity');
    if (!user) return fail(res, '队员不存在', 404, 404);
    const identity = user.associationIdentity;
    if (!identity || identity.studentId !== user.studentId || !/^[1-9]\d{0,18}$/.test(identity.userId)) {
      return success(res, { linked: false, profileUrl: null, honors: [] });
    }
    let envelope;
    try {
      const response = await axios.get('https://www.cwnupaa.com/api/certificate/honor-wall', {
        params: { userId: identity.userId }, headers: { Accept: 'application/json' },
        timeout: 15000, maxRedirects: 0,
      });
      envelope = response.data;
    } catch {
      return fail(res, '协会官网荣誉暂时无法读取，请稍后重试', 502, 502);
    }
    // This is the same public source used by the website's profile honor wall:
    // approved verifications and valid issued certificates; never local tickets.
    if (!envelope || envelope.code !== 200 || !Array.isArray(envelope.data)
      || !envelope.data.every((item: any) => item && ['string', 'number'].includes(typeof item.id) && typeof item.name === 'string')) {
      return fail(res, '协会官网荣誉数据格式异常，请稍后重试', 502, 502);
    }
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    const honors = envelope.data.map((item: any) => ({
      id: String(item.id), name: item.name, levelName: text(item.levelName),
      levelType: text(item.levelType), rankType: text(item.rankType), awardDate: text(item.awardDate),
      source: String(item.id).startsWith('G-') ? '官网颁发' : '已认证奖项',
    }));
    return success(res, { linked: true, websiteUserId: identity.userId, account: identity.account,
      profileUrl: `https://www.cwnupaa.com/profile/${identity.userId}`, honors });
  } catch {
    return fail(res, '读取队员荣誉失败，请稍后重试', 500, 500);
  }
};
