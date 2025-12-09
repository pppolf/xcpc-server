import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { getSnapshotData, getLeaderboard } from '../controllers/rating.controller';

const router = Router();

router.get('/snapshot', authMiddleware, getSnapshotData)

// 获取排行榜 (所有人可看)
router.get('/leaderboard', authMiddleware, getLeaderboard);

export default router;