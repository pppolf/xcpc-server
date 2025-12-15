import User, { IUser } from '../models/user.model';
import bcrypt from 'bcryptjs';
import MonthlySnapshot from '../models/monthly-snapshot.model';

// 查询参数接口
interface UserQuery {
  realName?: string;
  college?: string;
  grade?: string;
  gender?: string;
  role?: string;
  status?: string;
  username?: string; // 登录查找用
  studentId?: string; // 登录查找用
  page?: string;
  pageSize?: string;
}

// 辅助函数：加密密码
const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const createUser = async (userData: IUser) => {
  // 1. 设置默认密码并加密
  const plainPassword = userData.password || '123456';
  userData.password = await hashPassword(plainPassword);
  
  return await User.create(userData);
};

export const batchCreateUsers = async (users: IUser[]) => {
  // 1. 预先加密默认密码 (所有导入用户初始密码相同，只需加密一次)
  const defaultHashedPassword = await hashPassword('123456');

  const operations = users.map((user) => ({
    updateOne: {
      filter: { studentId: user.studentId },
      update: {
        $set: {
          ...user,
          password: user.password ? bcrypt.hashSync(user.password, 10) : defaultHashedPassword,
        },
      },
      upsert: true,
    },
  }));
  return await User.bulkWrite(operations);
};

// 2. findAllUsers 方法
export const findAllUsers = async (query: UserQuery) => {
  const matchStage: any = {};

  // 1. 构建筛选条件 ($match)
  // 默认隐藏管理员
  if (!query.role && !query.username && !query.studentId) {
    matchStage.role = { $ne: 'Teacher' }; 
  }

  // 模糊查询 (注意: Aggregation 中使用 regex 需谨慎，但在小数据量下没问题)
  if (query.realName) matchStage.realName = { $regex: query.realName, $options: 'i' };
  if (query.college) matchStage.college = { $regex: query.college, $options: 'i' };
  if (query.grade) matchStage.grade = { $regex: query.grade, $options: 'i' };

  // 精确查询
  if (query.gender) matchStage.gender = query.gender;
  if (query.role) matchStage.role = query.role;
  if (query.status) matchStage.status = query.status;
  if (query.username) matchStage.username = query.username;
  if (query.studentId) matchStage.studentId = query.studentId;

  // 2. 分页参数处理 (必须转为数字)
  const page = parseInt(query.page || '1');
  const pageSize = parseInt(query.pageSize || '10');
  const skip = (page - 1) * pageSize;

  // 3. 执行聚合管道
  const result = await User.aggregate([
    // 第一步：筛选数据
    { $match: matchStage },

    // 第二步：添加自定义排序权重字段 (roleOrder)
    {
      $addFields: {
        roleOrder: {
          $switch: {
            branches: [
              { case: { $eq: ['$role', 'Captain'] }, then: 1 },        // 队长排第 1
              { case: { $eq: ['$role', 'Vice-Captain'] }, then: 2 },        // 副队长排第 2
              { case: { $eq: ['$role', 'Student-Coach'] }, then: 3 },  // 学生教练排第 3
              { case: { $eq: ['$role', 'Member'] }, then: 4 }          // 普通队员排第 4
            ],
            default: 99 // 其他角色（如 Teacher 如果被查出来）排最后
          }
        }
      }
    },

    // 第三步：多级排序
    {
      $sort: {
        roleOrder: 1,       // 1. 按角色权重升序 (1->2->3)
        problemNumber: -1,  // 2. 按刷题量降序 (大->小)
        studentId: 1        // 3. 按学号升序 (小->大)
      }
    },

    // 第四步：分页与统计 (Facet)
    {
      $facet: {
        // 分支 A: 获取分页数据
        data: [
          { $skip: skip },
          { $limit: pageSize },
          // 剔除敏感字段和临时字段
          { $project: { password: 0, roleOrder: 0, __v: 0 } } 
        ],
        // 分支 B: 计算总数
        metadata: [
          { $count: 'total' }
        ]
      }
    }
  ]);

  // 4. 格式化返回结果
  // aggregate 返回的是数组 [{ data: [], metadata: [{ total: 10 }] }]
  const userList = result[0].data;
  const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;

  if (userList.length > 0) {
    // A. 确定要查哪个月的快照 (本月1号的快照 = 截止上月底的数据)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // B. 提取本页所有用户的 ID
    const userIds = userList.map((u: any) => u._id);

    // C. 去 MonthlySnapshot 表批量查找
    const snapshots = await MonthlySnapshot.find({
      userId: { $in: userIds },
      year: currentYear,
      month: currentMonth
    });

    // D. 建立哈希映射 (UserId -> TotalSolved) 方便快速查找
    const snapshotMap = new Map<string, number>();
    snapshots.forEach(s => snapshotMap.set(s.userId.toString(), s.totalSolved));

    // E. 将数据合并回 userList
    // 注意：aggregate 返回的对象不是 Mongoose Document，而是普通 JS 对象，可以直接赋值
    userList.forEach((user: any) => {
      // 如果 map 里有值，就取快照值；如果没有(新人或还没生成)，默认为 0
      user.lastMonthSolved = snapshotMap.get(user._id.toString()) || 0;
    });
  }
  // =======================================================

  return {
    list: userList,
    total,
    page,
    pageSize
  };
};

// 新增：登录验证逻辑
export const login = async (username: string, plainTextPassword: string) => {
  // 1. 查找用户 (显式 select +password，因为 Schema 默认不查)
  const user = await User.findOne({ 
    $or: [{ username }, { studentId: username }] 
  }).select('+password');

  if (!user) {
    throw new Error('用户不存在');
  }

  // 2. 比对加密密码
  const isMatch = await bcrypt.compare(plainTextPassword, user.password!);
  if (!isMatch) {
    throw new Error('密码错误');
  }

  // 3. 验证通过，返回用户信息 (去掉密码)
  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

export const findUserById = async (id: string) => {
  return await User.findById(id).select('-password');
};

export const updateUser = async (id: string, updateData: Partial<IUser>) => {
  // 如果更新包含密码，需要重新加密
  if (updateData.password) {
    updateData.password = await hashPassword(updateData.password);
  }
  return await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
};

export const deleteUser = async (studentId: string) => {
  return await User.findOneAndDelete({ studentId });
};