import { Request, Response } from 'express';
import RetirementRequest from '../models/retirement-request.model';
import User from '../models/user.model';
import Notification from '../models/notification.model';
import { success, fail } from '../utils/response';

const ADMIN_ROLES = ['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach'];

const getRequester = (req: Request) => req.user as { userId: string; role: string };

export const createRetirementRequest = async (req: Request, res: Response) => {
  try {
    const { userId } = getRequester(req);
    const { reason, contact } = req.body;

    if (!reason || String(reason).trim().length < 5) {
      return fail(res, '请填写退队原因，至少 5 个字');
    }

    const user = await User.findById(userId);
    if (!user) return fail(res, '用户不存在', 404);
    if (user.status === 'Retired') return fail(res, '你已经是退役状态，无需重复申请');
    if (user.role === 'Teacher') return fail(res, '教师账号不能提交队员退队申请');

    const pending = await RetirementRequest.findOne({ userId, status: 'Pending' });
    if (pending) return fail(res, '你已有一条待审批的退队申请，请等待管理员处理');

    const request = await RetirementRequest.create({
      userId,
      reason: String(reason).trim(),
      contact: contact ? String(contact).trim() : '',
    });

    success(res, request, '退队申请提交成功，请等待管理员审批');
  } catch (error: any) {
    fail(res, error.message || '退队申请提交失败', 500, 500);
  }
};

export const getRetirementRequests = async (req: Request, res: Response) => {
  try {
    const { userId, role } = getRequester(req);
    const { status, scope, page = 1, pageSize = 10 } = req.query;

    const filter: Record<string, any> = {};
    if (!ADMIN_ROLES.includes(role) || scope === 'me') {
      filter.userId = userId;
    }
    if (status && status !== 'All') {
      filter.status = status;
    }

    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const sizeNum = Math.max(parseInt(pageSize as string, 10) || 10, 1);
    const skip = (pageNum - 1) * sizeNum;

    const [total, list] = await Promise.all([
      RetirementRequest.countDocuments(filter),
      RetirementRequest.find(filter)
        .populate('userId', 'realName studentId role status trainingTeam college professional grade phone email')
        .populate('handledBy', 'realName studentId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sizeNum),
    ]);

    success(res, { list, total, page: pageNum, pageSize: sizeNum });
  } catch (error: any) {
    fail(res, error.message || '获取退队申请失败', 500, 500);
  }
};

export const handleRetirementRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, comment } = req.body as { action: 'approve' | 'reject'; comment?: string };
    const { userId: adminId } = getRequester(req);

    if (!['approve', 'reject'].includes(action)) {
      return fail(res, '无效的审批操作');
    }

    const request = await RetirementRequest.findById(id);
    if (!request) return fail(res, '退队申请不存在', 404);
    if (request.status !== 'Pending') {
      return fail(res, `该申请已处于 ${request.status} 状态，不能重复审批`);
    }

    const applicant = await User.findById(request.userId);
    if (!applicant) return fail(res, '申请人不存在', 404);

    request.handledBy = adminId as any;
    request.handledAt = new Date();

    if (action === 'reject') {
      request.status = 'Rejected';
      request.adminComment = comment || '管理员未填写驳回原因';
      await request.save();

      await Notification.create({
        userId: request.userId,
        title: '退队申请已驳回',
        content: `你的退队申请未通过。原因：${request.adminComment}`,
        type: 'warning',
        relatedId: request._id,
      });

      return success(res, request, '已驳回退队申请');
    }

    applicant.status = 'Retired';
    await applicant.save();

    request.status = 'Approved';
    request.adminComment = comment || '审批通过';
    await request.save();

    await Notification.create({
      userId: request.userId,
      title: '退队申请已通过',
      content: '你的退队申请已审批通过，队员状态已自动变更为已退役。',
      type: 'success',
      relatedId: request._id,
    });

    success(res, request, '审批通过，队员状态已变更为已退役');
  } catch (error: any) {
    fail(res, error.message || '审批退队申请失败', 500, 500);
  }
};
