import { Request, Response } from 'express';
import Notice from '../models/notice.model';
import User from '../models/user.model';
import { success, fail } from '../utils/response';
import path from 'path';

// 1. 创建公告 (Admin)
export const createNotice = async (req: Request, res: Response) => {
  try {
    // @ts-ignore (从中间件获取当前登录用户)
    const { userId } = req.user; 
    const { title, content, isTop, status, attachments } = req.body;

    const user = await User.findById(userId);
    if (!user) return fail(res, '当前登录用户不存在');

    const authorName = user.realName || user.username || '未知用户';

    if (!title || !content) return fail(res, '标题和内容不能为空');

    const notice = await Notice.create({
      title,
      content,
      isTop: isTop || false,
      status: status || 'DRAFT', // 默认草稿，除非前端传了 PUBLISHED
      author: userId,
      authorName: authorName, // 存名字
      attachments: attachments || [] // 附件列表
    });

    success(res, notice);
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 2. 修改公告 (Admin)
export const updateNotice = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // 这里用 _id (数据库主键)
    const updateData = req.body;

    const notice = await Notice.findByIdAndUpdate(id, updateData, { new: true });
    if (!notice) return fail(res, '公告不存在');

    success(res, notice);
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 3. 删除公告 (Admin)
export const deleteNotice = async (req: Request, res: Response) => {
  try {
    await Notice.findByIdAndDelete(req.params.id);
    success(res, '删除成功');
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 4. 获取管理列表 (Admin - 包含草稿，支持分页)
export const getAdminNoticeList = async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    
    let filter: any = {};
    if (status && status !== 'ALL') {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(pageSize);

    // 排序：置顶的在前 -> 创建时间倒序
    const [list, total] = await Promise.all([
      Notice.find(filter)
        .sort({ isTop: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(pageSize)),
      Notice.countDocuments(filter)
    ]);

    success(res, { list, total });
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 5. 获取公开列表 (Public - 只看已发布)
export const getPublicNoticeList = async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 10, keyword } = req.query;
    
    let filter: any = { status: 'PUBLISHED' }; // 🟢 强制只查已发布
    
    if (keyword) {
      filter.title = { $regex: keyword, $options: 'i' }; // 模糊搜索
    }

    const skip = (Number(page) - 1) * Number(pageSize);

    const [list, total] = await Promise.all([
      Notice.find(filter)
        .select('nid title authorName isTop createdAt views') // 列表页不需要 content (太大了)
        .sort({ isTop: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(pageSize)),
      Notice.countDocuments(filter)
    ]);

    success(res, { list, total });
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 6. 获取详情 (Public - 根据 nid: 1, 2, 3...)
export const getNoticeDetail = async (req: Request, res: Response) => {
  try {
    const { nid } = req.params;
    const nidNum = parseInt(nid);
    // 每次查看，浏览量 +1
    const notice = await Notice.findOneAndUpdate(
      { nid: nidNum }, 
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!notice) return fail(res, '公告不存在', 404);

    success(res, notice);
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 7. 根据数据库ID获取详情 (Admin 编辑回显用)
export const getNoticeById = async (req: Request, res: Response) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return fail(res, '公告不存在');
    success(res, notice);
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
}

// 8. 上传附件 支持单文件 (req.file) 和 多文件 (req.files)
export const handleUpload = (req: Request, res: Response) => {
  try {
    // 1. 检查是否有文件
    if (!req.file && (!req.files || (Array.isArray(req.files) && req.files.length === 0))) {
      return fail(res, '没有检测到上传文件', 400);
    }

    const publicDir = path.join(process.cwd(), 'public');

    // 🟢 辅助函数：将单个 file 对象转为我们要返回的 JSON 格式
    const processFile = (file: Express.Multer.File) => {
      // 计算相对路径: public/uploads/xxx.pdf -> /uploads/xxx.pdf
      let relativePath = path.relative(publicDir, file.path);
      // Windows 兼容处理 (\ -> /)
      relativePath = relativePath.split(path.sep).join('/');
      
      return {
        name: file.originalname,
        url: `/${relativePath}`, // 确保以 / 开头
        size: file.size,
        mimetype: file.mimetype
      };
    };

    // 2. 判断是单文件还是多文件
    if (req.files && Array.isArray(req.files)) {
      // 🔥 多文件模式：返回数组
      const fileList = (req.files as Express.Multer.File[]).map(processFile);
      
      // 返回结构: { list: [...] }
      success(res, { list: fileList });
    } else if (req.file) {
      // 🔥 单文件模式：返回单个对象
      const result = processFile(req.file);
      success(res, result);
    }

  } catch (error: any) {
    console.error('Upload Error:', error);
    fail(res, '文件上传处理失败: ' + error.message, 500);
  }
};