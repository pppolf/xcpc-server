// src/routes/common.routes.ts
import { Router } from 'express';
import * as commonController from '../controllers/common.controller';
import { upload } from '../middlewares/upload.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// 上传接口
// POST /common/upload
// 'file' 是前端 formData 中 append 的 key 名
router.post('/upload', authMiddleware, upload.single('file'), commonController.uploadFile);

export default router;