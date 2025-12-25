import { Router } from 'express';
import { roleMiddleware, authMiddleware } from '../middlewares/auth.middleware'; // 假设有鉴权中间件
import { syncAtCoder, syncCodeForces, syncData, syncLuogu, syncNowCoder } from '../controllers/submission.controller';

const router = Router();


// 获取 AtCoder 提交
router.get('/atcoder/:username', authMiddleware, syncAtCoder)
// 获取 CodeForces 提交
router.get('/codeforces/:username', authMiddleware, syncCodeForces)
// 获取 Luogu 提交
router.get('/luogu/:username', authMiddleware, syncLuogu)
// 获取 NowCoder 提交
router.get('/nowcoder/:userId', authMiddleware, syncNowCoder)
// 同步所有OJ
router.get('/sync', authMiddleware, syncData)

export default router;