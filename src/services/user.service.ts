import User, { IUser } from '../models/user.model';
import bcrypt from 'bcryptjs';
import MonthlySnapshot from '../models/monthly-snapshot.model';
import { isSystemAccount } from './auth.service';

// 查询参数接口
interface UserQuery {
  realName?: string;
  college?: string;
  grade?: string;
  gender?: string;
  role?: string;
  status?: string;
  trainingTeam?: string;
  account?: string;
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

// Member forms and imports cannot forge a verified association website binding.
const memberFields = (input: Partial<IUser>): Partial<IUser> => {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'associationIdentity' && !key.startsWith('$') && !key.includes('.')) clean[key] = value;
  }
  return clean;
};

export const createUser = async (userData: IUser) => {
  const fields = memberFields(userData);
  // 1. 设置默认密码并加密
  const plainPassword = fields.password || '123456';
  fields.password = await hashPassword(plainPassword);
  
  return await User.create(fields);
};

export const batchCreateUsers = async (users: IUser[]) => {
  // 1. 预先加密默认密码 (所有导入用户初始密码相同，只需加密一次)
  const defaultHashedPassword = await hashPassword('123456');

  const operations = users.map((user) => ({
    updateOne: {
      filter: { studentId: user.studentId },
      update: {
        $set: {
          ...memberFields(user),
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
  if (!query.role && !query.account && !query.username && !query.studentId) {
    matchStage.role = { $ne: 'Teacher' }; 
  }

  // Treat search input as literal text, including punctuation typed in real time.
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (query.realName) matchStage.realName = { $regex: escapeRegex(query.realName), $options: 'i' };
  if (query.college) matchStage.college = { $regex: escapeRegex(query.college), $options: 'i' };
  if (query.grade) matchStage.grade = { $regex: escapeRegex(query.grade), $options: 'i' };
  if (query.account) {
    const pattern = { $regex: escapeRegex(query.account), $options: 'i' };
    matchStage.$or = [{ username: pattern }, { studentId: pattern }];
  }

  // 精确查询
  if (query.gender) matchStage.gender = query.gender;
  if (query.role) matchStage.role = query.role;
  if (query.status) matchStage.status = query.status;
  if (query.trainingTeam) matchStage.trainingTeam = query.trainingTeam;
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

export const findUserById = async (id: string) => {
  return await User.findById(id).select('-password');
};

export const updateUser = async (id: string, updateData: Partial<IUser>) => {
  updateData = memberFields(updateData);
  // 如果更新包含密码，需要重新加密
  if (updateData.password) {
    updateData.password = await hashPassword(updateData.password);
  }
  return await User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).select('-password');
};

export const batchUpdateTrainingTeam = async (userIds: string[], trainingTeam: string) => {
  return await User.updateMany(
    { _id: { $in: userIds }, role: { $ne: 'Teacher' } },
    { $set: { trainingTeam } },
    { runValidators: true }
  );
};

export const batchUpdateMembers = async (
  identifiers: { userIds?: string[]; studentIds?: string[] },
  changes: { status?: 'Active' | 'Retired'; trainingTeam?: 'First' | 'Second' },
) => {
  const byStudentId = Boolean(identifiers.studentIds);
  const requested = [...new Set(identifiers.studentIds || identifiers.userIds || [])];
  const query = byStudentId ? { studentId: { $in: requested } } : { _id: { $in: requested } };
  const users = await User.find(query).select('_id studentId username role status trainingTeam');
  const keyFor = (user: any) => byStudentId ? user.studentId : String(user._id);
  const found = new Set(users.map(keyFor));
  const protectedUsers = users.filter(user => user.role === 'Teacher' || isSystemAccount(user.username));
  const eligible = users.filter(user => user.role !== 'Teacher' && !isSystemAccount(user.username));
  const fields = Object.entries(changes);
  const alreadySet = eligible.filter(user => fields.every(([key, value]) => user.get(key) === value));
  const needsUpdate = eligible.filter(user => fields.some(([key, value]) => user.get(key) !== value));
  // Exclude unchanged members so timestamps do not turn a repeated submission
  // into a false positive in MongoDB's modifiedCount.
  const result = needsUpdate.length ? await User.updateMany(
    { _id: { $in: needsUpdate.map(user => user._id) }, role: { $ne: 'Teacher' },
      $or: fields.map(([key, value]) => ({ [key]: { $ne: value } })) },
    { $set: changes },
    { runValidators: true },
  ) : { matchedCount: 0, modifiedCount: 0 };
  return {
    identifierType: byStudentId ? 'studentId' : 'userId',
    requestedCount: requested.length,
    matchedCount: alreadySet.length + result.matchedCount,
    modifiedCount: result.modifiedCount,
    unchangedCount: alreadySet.length + result.matchedCount - result.modifiedCount,
    notFound: requested.filter(id => !found.has(id)),
    protected: protectedUsers.map(keyFor),
    changedDuringUpdateCount: needsUpdate.length - result.matchedCount,
  };
};

export const findActiveUsersForExport = async () => {
  return await User.find({ status: 'Active', role: { $ne: 'Teacher' } })
    .select('-password -__v')
    .sort({ trainingTeam: 1, grade: 1, studentId: 1 })
    .lean();
};

export const deleteUser = async (studentId: string) => {
  return await User.findOneAndDelete({ studentId });
};
