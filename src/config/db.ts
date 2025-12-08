import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    // 这里修改你的数据库地址
    await mongoose.connect('mongodb://127.0.0.1:27017/xcpc_manager');
    console.log('MongoDB 连接成功');
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    process.exit(1);
  }
};

export default connectDB;