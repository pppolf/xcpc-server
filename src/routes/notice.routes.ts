import { Router } from 'express';
import { 
  createNotice, updateNotice, deleteNotice, 
  getAdminNoticeList, getPublicNoticeList, getNoticeDetail, getNoticeById, handleUpload
} from '../controllers/notice.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware'; // 假设你有这两个中间件
import { uploadAttachment } from '../middlewares/upload.middleware';

const router = Router();

// ==========================================
// 🔓 公开接口 (所有人可见)
// ==========================================

// 1. 获取公告列表 (已发布)
router.get('/list', authMiddleware, getPublicNoticeList);

// 2. 获取公告详情 (根据 nid: 101)
router.get('/view/:nid', authMiddleware, getNoticeDetail);


// ==========================================
// 🔒 管理员接口 (需要 Token + Admin权限)
// ==========================================

// 3. 获取管理列表 (含草稿)
router.get('/admin/list', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), getAdminNoticeList);

// 4. 获取单条详情 (根据 _id, 用于编辑回显)
router.get('/admin/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), getNoticeById);

// 5. 创建公告
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), createNotice);

// 6. 修改公告 (发布/撤回/修改内容)
router.put('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), updateNotice);

// 7. 删除公告
router.delete('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), deleteNotice);

// 8. 上传附件
router.post('/attachment', authMiddleware, uploadAttachment.array('file', 10),roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), handleUpload);


export default router;