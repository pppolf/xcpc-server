import { Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';
import {
  createRetirementRequest,
  getRetirementRequests,
  handleRetirementRequest,
} from '../controllers/retirement.controller';

const router = Router();
const adminRoles = ['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach'];

router.get('/', authMiddleware, getRetirementRequests);
router.post('/apply', authMiddleware, createRetirementRequest);
router.post('/handle/:id', authMiddleware, roleMiddleware(adminRoles), handleRetirementRequest);

export default router;
