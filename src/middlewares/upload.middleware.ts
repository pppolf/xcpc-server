// src/middlewares/upload.middleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

/**
 * 🛠️ 工厂函数：根据子目录名称创建 Multer 实例
 * @param subDir 子目录名 (例如 'avatars' 或 'proofs')
 */
const createUploader = (subDir: string = 'common') => {
  // 1. 动态确定上传目录
  const uploadPath = path.join(process.cwd(), 'public/uploads', subDir);

  // 2. 确保存储目录存在，不存在则自动创建
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }

  // 3. 配置存储策略
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadPath); // 存放到对应子目录
    },
    filename: function (req, file, cb) {
      // 生成唯一文件名: 时间戳-随机数.扩展名
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, uniqueSuffix + ext);
    }
  });

  // 4. 文件过滤器 (通用图片过滤)
  const fileFilter = (req: any, file: any, cb: any) => {
    // 这里可以根据 subDir 做特殊判断，比如头像必须是 jpg/png
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片格式!'), false);
    }
  };

  // 5. 返回配置好的 multer 实例
  return multer({
    storage: storage,
    limits: {
      fileSize: 2 * 1024 * 1024 // 默认限制 2MB
    },
    fileFilter: fileFilter
  });
};

// 🌟 导出不同的上传中间件

// 1. 通用上传 (用于奖项凭证等)，存放在 public/uploads/common
export const upload = createUploader('common'); 

// 2. 头像上传 (专门用于用户头像)，存放在 public/uploads/avatars
export const uploadAvatar = createUploader('avatars');