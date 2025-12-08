import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import connectDB from './config/db';
import { initGlobalConfig } from './services/config.service';
import { initScheduledJobs } from './jobs/schedule';

import userRoutes from './routes/user.routes';
import contestRoutes from './routes/contest.routes';
import crawlerRoutes from './routes/crawler.routes';
import configRoutes from './routes/config.routes';
import ratingRoutes from './routes/rating.routes';

import User from './models/user.model'; // 引入 User 模型
import bcrypt from 'bcryptjs'; // 引入 bcrypt

const app = express();
const PORT = 3000;

// 1. 连接数据库
connectDB().then(async () => {
    await initGlobalConfig();

    // 启动定时任务
    initScheduledJobs()
    // --- 🥚 自动初始化超级管理员逻辑 ---
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            console.log('检测到数据库为空，正在初始化默认管理员...');

            // 加密密码
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('123456', salt);
            
            await User.create({
                username: 'admin',          // 登录账号
                password: hashedPassword,         // 加密密码
                realName: '超级管理员',
                role: 'Teacher',            // 必须是 Teacher 才有最高权限
                status: 'Active',
                
                // 以下是必填项的默认填充值
                gender: '男',
                college: '计算机学院',
                professional: '系统管理',
                grade: '2023级',
                studentId: '000000',        // 特殊学号
                phone: '13800000000',
                idCard: '110101199001010001',
                email: 'admin@xcpc.com',
                tsize: 'L',
                ojInfo: {},
                problemNumber: 0,
                rating: 0,
                ratingInfo: {}
            });
            
            console.log('✅ 默认管理员已创建！');
            console.log('👉 账号: admin');
            console.log('👉 密码: 123456');
        }
    } catch (error) {
        console.error('初始化管理员失败:', error);
    }
});

// 2. 中间件配置
app.use(cors()); // 允许跨域
app.use(express.json()); // 解析 JSON Body

// 3. 注册路由
app.use('/users', userRoutes);
app.use('/contests', contestRoutes);
app.use('/crawler', crawlerRoutes);
app.use('/config', configRoutes);
app.use('/rating', ratingRoutes);

// 4. 启动服务
app.listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});