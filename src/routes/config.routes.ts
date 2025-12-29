import { Router } from 'express';
import * as configController from '../controllers/config.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 获取赛季 (所有人可看)
router.get('/season', configController.getSeason);

// 修改赛季 (只有老师/队长可以)
router.post('/season', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), configController.setSeason);

// 设置 AtCoder Cookie
router.post('/atcoder_cookie', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), configController.setAtCoderCookie);
router.get('/atcoder_cookie', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), configController.getAtCoderCookie);

export default router;