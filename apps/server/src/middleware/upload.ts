import multer from 'multer';
import { ALLOWED_AUDIO_MIME_TYPES } from '@froa/shared';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';

/**
 * 音频上传中间件。
 *
 * 先落到内存（上限内），再由 storage 驱动写盘 —— 因为写盘路径需要
 * workspace/recipe 信息，必须等鉴权与业务校验通过之后才知道。
 */
export const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadMb * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const mime = (file.mimetype || '').toLowerCase();
    if ((ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
      callback(null, true);
      return;
    }
    callback(new ApiError('UPLOAD_TYPE_NOT_ALLOWED', `不支持的音频格式：${mime || '未知'}`));
  },
});

/** 把 multer 自身的错误翻译成统一错误码 */
export function translateUploadError(error: unknown): ApiError | null {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new ApiError('UPLOAD_TOO_LARGE', `单个音频不能超过 ${env.maxUploadMb}MB`);
    }
    return new ApiError('VALIDATION_FAILED', `上传失败：${error.message}`);
  }
  if (error instanceof ApiError) return error;
  return null;
}
