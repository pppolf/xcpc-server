import { Router } from 'express';
import { getManualContests, addManualContest, deleteManualContest, refreshContests } from '../controllers/upcoming.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 获取列表 (用于管理页)
router.get('/', authMiddleware, getManualContests);
// 添加/删除 (需要管理员权限)
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), addManualContest);
router.delete('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), deleteManualContest);
// 刷新路由 (POST /upcoming/refresh)
router.post('/refresh', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), refreshContests);
export default router;