import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { success, fail } from '../utils/response';
import { generateToken } from '../utils/jwt';

// 获取列表
export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await userService.findAllUsers(req.query);
    success(res, users);
  } catch (error) {
    // 500 错误通常也设置 HTTP 状态码为 500
    fail(res, '服务器错误', 500, 500);
  }
};

// 登录接口
export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return fail(res, '账号密码不能为空');
    }
    
    // 1. 验证账号密码
    const user = await userService.login(username, password);
    
    // 2. 生成真实 JWT Token
    // payload 放入我们后续可能需要的信息，比如 ID、角色
    const token = generateToken({
      userId: user._id.toString(), // 转成字符串
      username: user.username,
      role: user.role
    });
    
    // 3. 返回
    success(res, { user, token }, '登录成功');
  } catch (error: any) {
    fail(res, error.message || '登录失败', 401);
  }
};

// 新增单个
export const createUser = async (req: Request, res: Response) => {
  try {
    const newUser = await userService.createUser(req.body);
    
    // Mongoose 的 toObject() 返回的是对象，为了避免 TS 报错，可以转为 any 删除属性
    const userObj = newUser.toObject() as any;
    delete userObj.password;
    
    success(res, userObj, '新增成功');
  } catch (error: any) {
    // 处理 MongoDB 唯一索引冲突 (E11000)
    if (error.code === 11000) {
       // 返回业务码 400，HTTP 状态码 200 (前端拦截器会拦截 code!=200)
       return fail(res, '学号或用户名已存在', 400);
    }
    return fail(res, error.message || '新增失败', 400);
  }
};

// 批量导入
export const batchImportUsers = async (req: Request, res: Response) => {
  try {
    const result = await userService.batchCreateUsers(req.body);
    success(res, result, '批量导入成功');
  } catch (error) {
    console.error(error);
    fail(res, '导入失败，请检查数据格式', 500, 500);
  }
};

// 更新
export const updateUser = async (req: Request, res: Response) => {
  try {
    const updatedUser = await userService.updateUser(req.params.id, req.body);
    
    if (!updatedUser) {
      return fail(res, '用户不存在', 404);
    }
    
    success(res, updatedUser, '更新成功');
  } catch (error) {
    fail(res, '更新失败', 500, 500);
  }
};

// 删除
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const result = await userService.deleteUser(req.params.studentId);
    
    if (!result) {
      // 统一使用 fail
      return fail(res, '用户不存在', 404); 
    }
    
    // 统一使用 success (data 为 null 即可)
    success(res, null, '删除成功');
  } catch (error) {
    fail(res, '删除失败', 500, 500);
  }
};