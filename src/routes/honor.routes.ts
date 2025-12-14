import { Router } from 'express';
import { 
  createHonor, updateHonor, deleteHonor, 
  getAdminHonorList, getPublicHonorList, getHonorDetail, getHonorById 
} from '../controllers/honor.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';
import { handleUpload } from '../controllers/notice.controller';
import { uploadAttachment } from '../middlewares/upload.middleware';

const router = Router();

// =======================
// 🔓 公开接口
// =======================
router.get('/list', getPublicHonorList);
router.get('/view/:hid', getHonorDetail);

// =======================
// 🔒 管理接口
// =======================
router.get('/admin/list', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), getAdminHonorList);
router.get('/admin/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), getHonorById);
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), createHonor);
router.put('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), updateHonor);
router.delete('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), deleteHonor);


// 上传附件（喜报封面）
router.post('/attachment', authMiddleware, uploadAttachment.array('file', 10), roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), handleUpload)

export default router;