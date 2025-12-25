import { Router } from 'express';
import { getChartData, getTableData } from '../controllers/stats.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 获取图表数据 (Charts Overview)
router.get('/charts', authMiddleware, getChartData);

// 获取表格数据 (Submission List)
router.get('/records', authMiddleware, getTableData);

export default router;