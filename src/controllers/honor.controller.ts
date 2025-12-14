import { Request, Response } from 'express';
import Honor from '../models/honor.model';
import User from '../models/user.model';
import { success, fail } from '../utils/response';

// 1. 创建喜报
export const createHonor = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const { userId } = req.user;
    const { title, content, coverImage, eventDate, status, attachments } = req.body;

    if (!title || !content) return fail(res, '标题和内容不能为空');

    // 获取作者名
    const user = await User.findById(userId);
    const authorName = user?.realName || user?.username || '超级管理员';

    const honor = await Honor.create({
      title,
      content,
      coverImage: coverImage || '', // 允许为空
      eventDate: eventDate || new Date(),
      status: status || 'DRAFT',
      author: userId,
      authorName,
      attachments: attachments || []
    });

    success(res, honor);
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 2. 更新喜报
export const updateHonor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const honor = await Honor.findByIdAndUpdate(id, updateData, { new: true });
    if (!honor) return fail(res, '喜报不存在');

    success(res, honor);
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 3. 删除喜报
export const deleteHonor = async (req: Request, res: Response) => {
  try {
    await Honor.findByIdAndDelete(req.params.id);
    success(res, '删除成功');
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 4. 获取管理列表 (Admin - 含草稿)
export const getAdminHonorList = async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    
    let filter: any = {};
    if (status && status !== 'ALL') {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(pageSize);

    const [list, total] = await Promise.all([
      Honor.find(filter)
        .sort({ eventDate: -1, createdAt: -1 }) // 按获奖时间倒序
        .skip(skip)
        .limit(Number(pageSize)),
      Honor.countDocuments(filter)
    ]);

    success(res, { list, total });
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 5. 获取公开列表 (Public - 卡片墙)
export const getPublicHonorList = async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 12 } = req.query; // 卡片式布局，一般一页多一点
    
    const filter = { status: 'PUBLISHED' };
    const skip = (Number(page) - 1) * Number(pageSize);

    const [list, total] = await Promise.all([
      Honor.find(filter)
        // 列表页只需要这些字段，不需要 content
        .select('hid title coverImage eventDate authorName views') 
        .sort({ eventDate: -1 }) // 最新获奖的在前面
        .skip(skip)
        .limit(Number(pageSize)),
      Honor.countDocuments(filter)
    ]);

    success(res, { list, total });
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 6. 获取详情 (Public - 根据 hid)
export const getHonorDetail = async (req: Request, res: Response) => {
  try {
    const { hid } = req.params;
    
    const honor = await Honor.findOneAndUpdate(
      { hid: parseInt(hid) },
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!honor) return fail(res, '喜报不存在', 404);
    success(res, honor);
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 7. 根据 ID 获取 (Edit 回显)
export const getHonorById = async (req: Request, res: Response) => {
  try {
    const honor = await Honor.findById(req.params.id);
    if (!honor) return fail(res, '不存在');
    success(res, honor);
  } catch (e: any) {
    fail(res, e.message);
  }
};