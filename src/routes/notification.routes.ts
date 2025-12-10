import { Router } from 'express';
import * as notiController from '../controllers/notification.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', authMiddleware, notiController.getMyNotifications);
router.put('/read/:id', authMiddleware, notiController.readNotification);
router.put('/read-all', authMiddleware, notiController.readAllNotifications);

export default router;