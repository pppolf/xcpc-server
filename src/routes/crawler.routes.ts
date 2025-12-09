import { Router } from 'express';
import * as crawlerController from '../controllers/crawler.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 手动刷新 (管理员可以刷新，这里简单点先只给管理员)
router.post('/refresh', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), crawlerController.refreshUser);

router.get('/targets', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), crawlerController.getRefreshTargets);

export default router;