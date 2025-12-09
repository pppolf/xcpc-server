import { Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';
import { getTickets, createTicket, handleTicket } from '../controllers/ticket.controller';

const router = Router();

// 获取排行榜 (所有人可看)
router.get('/', authMiddleware, getTickets);

// 用户提交工单
router.post('/apply', authMiddleware, createTicket);

// 审核工单
router.post('/handle/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), handleTicket);

export default router;