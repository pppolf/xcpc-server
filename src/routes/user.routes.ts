import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// POST /users/login - 登录 (放在最前面，防止被 :id 拦截)
router.post('/login', userController.login);

// GET /users - 获取列表(带筛选)
router.get('/', authMiddleware, userController.getUsers);

// POST /users - 新增用户
router.post('/', authMiddleware, userController.createUser);

// POST /users/batch - 批量导入
router.post('/batch', authMiddleware, userController.batchImportUsers);

// PUT /users/:id - 更新用户
router.put('/:id', authMiddleware, userController.updateUser);

// DELETE /users/:studentId - 删除用户
router.delete('/:studentId', authMiddleware, userController.deleteUser);

export default router;