import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authMiddleware, roleMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// POST /users/login - 登录 (放在最前面，防止被 :id 拦截)
router.post('/login', userController.login);

// GET /users - 获取列表(带筛选)
router.get('/', authMiddleware, userController.getUsers);

// POST /users - 新增用户
router.post('/', authMiddleware, roleMiddleware(['Teacher', 'Captain','Vice-Captain', 'Student-Coach']), userController.createUser);

// POST /users/batch - 批量导入
router.post('/batch', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), userController.batchImportUsers);

// PUT /users/:id - 更新用户
router.put('/:id', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), userController.updateUser);

// DELETE /users/:studentId - 删除用户
router.delete('/:studentId', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), userController.deleteUser);

// 获取个人信息 (必须加 authMiddleware)
router.get('/profile', authMiddleware, userController.getUserProfile);

// 根据id获取用户展示信息
router.get('/:id', authMiddleware, userController.getUserById);

// [新增] 用户修改自己的密码
router.post('/update-password', authMiddleware, userController.updatePassword);

// [新增] 管理员重置他人密码 (需要 Teacher 或 Captain 权限)
router.post('/reset-password', authMiddleware, roleMiddleware(['Teacher', 'Captain', 'Vice-Captain', 'Student-Coach']), userController.resetUserPassword);

export default router;