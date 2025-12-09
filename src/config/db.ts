import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    // 这里修改你的数据库地址
    await mongoose.connect(process.env.MONGO_URI || '');
    console.log('MongoDB 连接成功');
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    process.exit(1);
  }
};

export default connectDB;