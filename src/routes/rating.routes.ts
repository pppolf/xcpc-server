import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { getSnapshotData } from '../controllers/rating.controller';

const router = Router();

router.get('/snapshot', authMiddleware, getSnapshotData)

export default router;