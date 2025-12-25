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
import ticketRoutes from './routes/ticket.routes';
import commonRoutes from './routes/common.routes';
import notificationRoutes from './routes/notification.routes';
import noticeRoutes from './routes/notice.routes';
import honorRoutes from './routes/honor.routes';
import dashboardRoutes from './routes/dashboard.routes';
import trainingRoutes from './routes/training.routes';
import submissionRoutes from './routes/submission.routes';
import statsRoutes from './routes/stats.routes';

import User from './models/user.model';
import bcrypt from 'bcryptjs';
import path from 'path';

const app = express();
const PORT = 3000;

// ==========================================
// 1. 先配置中间件和路由 (Sync 代码先执行)
// ==========================================
app.use(cors());
app.use('/uploads', express.static(path.join(process.cwd(), 'public/uploads')));
app.use(express.json());

app.use('/users', userRoutes);
app.use('/contests', contestRoutes);
app.use('/crawler', crawlerRoutes);
app.use('/config', configRoutes);
app.use('/rating', ratingRoutes);
app.use('/tickets', ticketRoutes);
app.use('/common', commonRoutes);
app.use('/notifications', notificationRoutes);
app.use('/notices', noticeRoutes);
app.use('/honors', honorRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/training', trainingRoutes);
app.use('/submissions', submissionRoutes);
app.use('/stats', statsRoutes)

// ==========================================
// 2. 连接数据库 -> 初始化配置 -> 启动服务 (Async 链式调用)
// ==========================================
connectDB().then(async () => {
    
    // 🟢 第一步：必须先加载配置！
    await initGlobalConfig();

    // 🟢 第二步：启动定时任务
    initScheduledJobs();

    // 🟢 第三步：初始化管理员 (如果需要)
    try {
        const count = await User.countDocuments();
        if (count === 0) {
            console.log('检测到数据库为空，正在初始化默认管理员...');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('123456', salt);
            
            await User.create({
                username: 'admin',
                password: hashedPassword,
                realName: '超级管理员',
                role: 'Teacher',
                status: 'Active',
                avatar: '',
                // ... 你的默认字段 ...
                gender: '男', college: '计算机学院', professional: '系统管理', grade: '2023级',
                studentId: '000000', phone: '13800000000', idCard: '110101199001010001',
                email: 'admin@xcpc.com', tsize: 'L', ojInfo: {}, problemNumber: 0, rating: 0, ratingInfo: {}, ojStats: {}
            });
            console.log('✅ 默认管理员已创建！');
        }
    } catch (error) {
        console.error('初始化管理员失败:', error);
    }

    // ==========================================
    // 🟢 核心修复：只有上面全做完了，才允许启动服务器！
    // ==========================================
    app.listen(PORT, () => {
        console.log(`Server running at http://127.0.0.1:${PORT}`);
        console.log(`[System] 系统初始化完成，当前赛季: ${require('./services/config.service').getCurrentSeason()}`);
    });

}).catch((err) => {
    console.error('❌ 数据库连接失败，服务器无法启动:', err);
    process.exit(1);
});