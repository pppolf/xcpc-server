import { Router } from 'express';
import * as contestController from '../controllers/contest.controller';
// 引入中间件 (只有登录用户/管理员能操作)
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 获取某人的比赛记录 (所有登录用户可看)
router.get('/user/:userId', authMiddleware, contestController.getUserContestRecords);

// 录入比赛 (建议只有管理员可操作)
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain',  'Student-Coach']), contestController.addContestRecord);

// 删除记录 (管理员)
router.delete('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), contestController.deleteContestRecord);

export default router;