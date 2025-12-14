// src/middlewares/upload.middleware.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

interface UploaderOptions {
  limit?: number; // 文件大小限制 (字节)
  filterType?: 'image' | 'file'; // 过滤器模式: 'image'只允许图片, 'file'允许文档和压缩包
}

/**
 * 🛠️ 工厂函数：根据子目录名称创建 Multer 实例
 * @param subDir 子目录名 (例如 'avatars' 或 'proofs')
 */
const createUploader = (subDir: string = 'common', options: UploaderOptions = {}) => {
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
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      // 生成唯一文件名: 时间戳-随机数.扩展名
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, uniqueSuffix + ext);
    }
  });

  // 4. 文件过滤器 (通用图片过滤)
  const fileFilter = (req: any, file: any, cb: any) => {
    const { filterType = 'image' } = options;
    const ext = path.extname(file.originalname).toLowerCase();
    // 这里可以根据 subDir 做特殊判断，比如头像必须是 jpg/png
    if (filterType === 'image') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('只允许上传图片格式!'), false);
      }
    } else {
      // 模式 B: 允许常见附件 (PDF, Office, 压缩包, 图片, 文本)
      // 黑名单机制：严禁上传可执行文件
      const allowedDocs = [
        '.doc', '.docx', 
        '.xls', '.xlsx', 
        '.csv', 
        '.pdf', 
        '.zip', '.rar', '.7z',
        '.txt', '.md',
        '.png', '.jpg', '.jpeg', '.gif', '.bmp'
      ];
      
      if (allowedDocs.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`不支持的文件格式: ${ext}，仅支持 doc/txt/xls/pdf/md/zip 等文档`), false);
      }
    }
  };

  // 5. 返回配置好的 multer 实例
  return multer({
    storage: storage,
    limits: {
      fileSize: options.limit || 2 * 1024 * 1024 // 默认限制 2MB
    },
    fileFilter: fileFilter
  });
};

// 🌟 导出不同的上传中间件

// 1. 通用图片上传 (奖项凭证等)
// 限制: 2MB, 仅图片
export const upload = createUploader('common', { 
  limit: 2 * 1024 * 1024, 
  filterType: 'image' 
}); 

// 2. 头像上传
// 限制: 2MB, 仅图片
export const uploadAvatar = createUploader('avatars', { 
  limit: 2 * 1024 * 1024, 
  filterType: 'image' 
});

// 3. 附件上传 (用于公告附件)
// 存放在: public/uploads/attachments
// 限制: 20MB, 允许文档和压缩包
export const uploadAttachment = createUploader('attachments', { 
  limit: 20 * 1024 * 1024,
  filterType: 'file' 
});