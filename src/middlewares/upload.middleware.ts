// src/middlewares/upload.middleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// 确保上传目录存在
const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置存储策略
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名: 时间戳-随机数.扩展名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

// 文件过滤器
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传图片格式 (jpg, png, gif, webp)'), false);
  }
};

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 限制 2MB
  },
  fileFilter: fileFilter
});