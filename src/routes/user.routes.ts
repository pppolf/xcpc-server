import { Router } from 'express';
import * as userController from '../controllers/user.controller';

const router = Router();

// POST /users/login - 登录 (放在最前面，防止被 :id 拦截)
router.post('/login', userController.login);

// GET /users - 获取列表(带筛选)
router.get('/', userController.getUsers);

// POST /users - 新增用户
router.post('/', userController.createUser);

// POST /users/batch - 批量导入
router.post('/batch', userController.batchImportUsers);

// PUT /users/:id - 更新用户
router.put('/:id', userController.updateUser);

// DELETE /users/:studentId - 删除用户
router.delete('/:studentId', userController.deleteUser);

export default router;