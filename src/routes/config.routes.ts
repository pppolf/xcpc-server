import { Router } from 'express';
import * as configController from '../controllers/config.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 获取赛季 (所有人可看)
router.get('/season', configController.getSeason);

// 修改赛季 (只有老师/队长可以)
router.post('/season', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Student-Coach']), configController.setSeason);

// 测试用
router.post('/initSnapshots', authMiddleware, roleMiddleware(['Teacher']), configController.initSnapshots)

// 测试用
router.post('/forceSettle', authMiddleware, roleMiddleware(['Teacher']), configController.forceSettle)


export default router;