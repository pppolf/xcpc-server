import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { success, fail } from '../utils/response';
import { generateToken } from '../utils/jwt';
import User from '../models/user.model';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

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

// 获取个人信息
export const getUserProfile = async (req: Request, res: Response) => {
  // 1. 找到所有 ratingInfo 是 null 的用户，把整个对象初始化
  await User.updateMany(
    { ratingInfo: null }, 
    { 
      $set: { 
        ratingInfo: { 
          contest: 0, 
          problem: 0, 
          legacy: 0, 
          activeCoefficient: 1.0 
        } 
      } 
    }
  );
  try {
    // req.user 是 authMiddleware 解析 Token 后挂载的
    // 但 Token 里的信息可能过时，建议拿着 ID 去数据库查最新的
    // @ts-ignore
    const userId = req.user.userId;

    const user = await User.findById(userId).select('-password'); // 不返回密码
    
    if (!user) {
      return fail(res, '用户不存在', 404);
    }

    success(res, user);
  } catch (error: any) {
    fail(res, error.message || '获取用户信息失败', 500);
  }
};

// 根据id获取用户展示信息
export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // 排除密码字段
    const user = await User.findById(id).select('-password');
    if (!user) return fail(res, '用户不存在');
    success(res, user);
  } catch (e: any) {
    fail(res, e.message);
  }
};

// 修改密码
export const updatePassword = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user.userId; // 从 Token 解析出来的当前用户 ID
    const { oldPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return fail(res, '新密码长度不能少于 6 位');
    }

    const user = await User.findById(userId).select('+password');
    if (!user) return fail(res, '用户不存在');

    // 1. 验证旧密码
    // 注意：如果是通过脚本批量导入的用户，可能没有加密，这里要做兼容处理
    // 但为了安全，通常假设数据库里存的都是 hash。
    // 如果你之前的导入逻辑是明文存的，这里要小心。假设都是加密的：
    const isMatch = await bcrypt.compare(oldPassword, user.password as string);
    if (!isMatch) {
      return fail(res, '旧密码错误');
    }

    // 2. 加密新密码
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    success(res, null, '密码修改成功');
  } catch (error: any) {
    fail(res, error.message || '修改失败', 500);
  }
};

// 重置密码
export const resetUserPassword = async (req: Request, res: Response) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return fail(res, '参数缺失');
    }

    const user = await User.findById(userId);
    if (!user) return fail(res, '目标用户不存在');

    // 直接覆盖密码，不需要验证旧密码
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    success(res, null, `已将用户 ${user.realName} 的密码重置`);
  } catch (error: any) {
    fail(res, error.message || '重置失败', 500);
  }
};

// 上传头像
export const uploadAvatar = async (req: Request & { file?: Express.Multer.File }, res: Response) => {
  try {
    // 1. 基础校验
    if (!req.file) {
      return fail(res, '请选择要上传的文件');
    }

    const userId = req.user?.userId;
    if (!userId) {
      // 如果未授权，顺手把刚上传的文件删掉，防止垃圾文件堆积
      fs.unlinkSync(req.file.path); 
      return fail(res, '未授权');
    }

    // 2. 构造新的头像 URL (存入数据库的路径)
    // 这里的 'avatars' 必须和你 middleware 里配置的文件夹名一致
    // 强制使用正斜杠 /，确保在 Windows 和 Linux 上都能被浏览器正确识别为 URL
    const filename = req.file.filename;
    const newAvatarUrl = `/uploads/avatars/${filename}`;

    // 3. 查找用户并删除旧头像
    const currentUser = await User.findById(userId);
    
    if (!currentUser) {
      fs.unlinkSync(req.file.path); // 回滚：删除刚上传的新图
      return fail(res, '用户不存在');
    }

    // 如果用户之前有头像，且不是默认头像，且文件确实存在于硬盘上，则删除它
    if (currentUser.avatar && !currentUser.avatar.includes('default')) {
      // 计算旧文件的绝对路径
      // 假设 public 是你的静态资源根目录
      const oldAvatarPath = path.join(process.cwd(), 'public', currentUser.avatar);
      
      // 异步删除旧文件，不阻塞主流程，出错了也不影响本次上传
      fs.access(oldAvatarPath, fs.constants.F_OK, (err) => {
        if (!err) {
          fs.unlink(oldAvatarPath, (unlinkErr) => {
            if (unlinkErr) console.error('删除旧头像失败:', unlinkErr);
          });
        }
      });
    }

    // 4. 更新数据库
    currentUser.avatar = newAvatarUrl;
    await currentUser.save(); 
    // 或者使用 findByIdAndUpdate，但用 save() 可以触发 mongoose 的 pre-save 钩子(如果有的话)

    // 5. 返回结果 (手动排除密码，或者依赖 User 模型里的 toJSON 配置)
    const userObj = currentUser.toObject();
    delete (userObj as any).password;

    return success(res, userObj);

  } catch (error: any) {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    console.error('上传头像异常:', error);
    return fail(res, error.message || '头像上传失败');
  }
};