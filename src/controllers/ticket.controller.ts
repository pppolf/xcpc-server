import { Request, Response } from 'express';
import Ticket from '../models/ticket.model';
import ContestRecord from '../models/contest-record.model'; // 🟢 [新增] 引入比赛记录模型
import * as ratingService from '../services/rating.service'; // 🟢 [新增] 引入算分服务
import { success, fail } from '../utils/response';
import Notification from '../models/notification.model';

// 用户提交工单
export const createTicket = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId;
    const ticket = await Ticket.create({ ...req.body, userId });
    success(res, ticket, '申请提交成功，请等待审核');
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 获取工单列表 (接口参赛权限校验)
export const getTickets = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const { role, userId } = req.user;
    const { status, scope, page, pageSize } = req.query;
    
    let filter: any = {};
    // 如果不是老师/队长，只能看自己的
    if (role === 'Member' || scope === 'me') {
      filter.userId = userId;
    }
    if (status) filter.status = status;

    const pageNum = page ? parseInt(page as string) : 0;
    const sizeNum = pageSize ? parseInt(pageSize as string) : 10;
    if (pageNum > 0) {
      // 🟢 分支 A: 分页模式 (返回 { list, total })
      const skip = (pageNum - 1) * sizeNum;

      // 并行执行：查总数 + 查当前页数据
      const [total, list] = await Promise.all([
        Ticket.countDocuments(filter),
        Ticket.find(filter)
          .populate('userId', 'realName studentId') // 关联用户信息
          .sort({ createdAt: -1 }) // 按时间倒序
          .skip(skip)
          .limit(sizeNum)
      ]);

      success(res, {
        list,
        total,
        page: pageNum,
        pageSize: sizeNum
      });
    } else {
      const list = await Ticket.find(filter)
        .populate('userId', 'realName studentId')
        .sort({ createdAt: -1 });

      success(res, {list});
    }   
  } catch (e: any) {
    fail(res, e.message, 500, 500);
  }
};

// 审批工单 (管理员)
export const handleTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, comment } = req.body; // action: 'approve' | 'reject'
    
    const ticket = await Ticket.findById(id);
    if (!ticket) return fail(res, '工单不存在');
    
    // 防止重复操作
    if (ticket.status !== 'Pending') {
      return fail(res, `该工单已处于 ${ticket.status} 状态，无法再次操作`);
    }

    // === 🔴 驳回逻辑 ===
    if (action === 'reject') {
      ticket.status = 'Rejected';
      ticket.adminComment = comment || '管理员未填写理由'; // 给个默认值
      await ticket.save();

      // 发送驳回通知
      await Notification.create({
        userId: ticket.userId,
        title: '⚠️ 申请被驳回',
        content: `很遗憾，您申请的 "${ticket.contestName}" 被驳回。原因：${ticket.adminComment}`,
        type: 'warning',
        relatedId: ticket._id
      });

      return success(res, null, '操作成功：已驳回申请');
    }

    // === 🟢 通过逻辑 (核心实现) ===
    if (action === 'approve') {
      
      // 1. 计算原始得分 (复用 ratingService 的逻辑)
      // 注意参数顺序: type, awardLevel, season, N(总数), rk(排名)
      const rawScore = ratingService.calculateRawScore(
        ticket.type,
        ticket.awardLevel || null,
        ticket.season,
        ticket.totalParticipants || 0,
        ticket.rank || 0
      );

      // 2. 创建正式比赛记录
      // 注意：ticket.contestName 对应 record.name
      await ContestRecord.create({
        userId: ticket.userId,
        type: ticket.type,
        name: ticket.contestName, 
        season: ticket.season,
        awardLevel: ticket.awardLevel || undefined,
        rank: ticket.rank || 0,
        totalParticipants: ticket.totalParticipants || 0,
        rawScore: rawScore,
        ...ratingService.getContestArchiveFields(ticket.season),
        contestDate: ticket.createdAt // 使用工单提交时间作为比赛录入时间
      });

      // 3. 触发该用户的总分重算
      await ratingService.updateUserTotalRating(ticket.userId.toString());
      
      // 4. 更新工单状态
      ticket.status = 'Approved';
      ticket.adminComment = '通过';
      await ticket.save();

      // 发送通过通知
      await Notification.create({
        userId: ticket.userId,
        title: '✅ 申请已通过',
        content: `恭喜！您申请的 "${ticket.contestName}" 已审核通过并加分。`,
        type: 'success',
        relatedId: ticket._id
      });

      return success(res, { rawScore }, '审核通过，已自动生成比赛记录并更新 Rating');
    }

    return fail(res, '无效的操作指令');

  } catch (e: any) {
    console.error(e);
    fail(res, e.message || '处理工单失败', 500);
  }
};
