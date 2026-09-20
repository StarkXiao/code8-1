import { ERROR_CODES, type ErrorCode } from '@froa/shared';

const DEFAULT_MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: '邮箱或密码不正确',
  AUTH_TOKEN_EXPIRED: '登录状态已过期，请重新登录',
  AUTH_TOKEN_INVALID: '登录凭证无效',
  AUTH_MISSING_TOKEN: '请先登录',
  AUTH_EMAIL_TAKEN: '该邮箱已被注册',
  AUTH_FORBIDDEN: '当前角色没有执行该操作的权限',
  WORKSPACE_NOT_MEMBER: '你不是该家庭空间的成员',
  WORKSPACE_INVALID_INVITE: '邀请码无效或已失效',
  RESOURCE_NOT_FOUND: '资源不存在或已被删除',
  EDIT_CONFLICT: '内容已被他人修改，请刷新后重试',
  VERSION_NOT_EDITABLE: '只有草稿版本可以修改',
  VERSION_DUPLICATE_DRAFT: '该食谱已存在一个草稿版本',
  VERSION_INVALID_TRANSITION: '当前版本状态不允许该操作',
  SPEC_INCOMPLETE: '可复做规格填写不完整',
  SPEC_ASSUMED_UNCONFIRMED: '存在尚未确认的暂定值，请先确认或标记为口语留白后再发布',
  CHANGE_NOTE_REQUIRED: '发布版本必须填写变更说明',
  DEVIATION_REQUIRED: '复做失败或部分成功时必须填写偏差说明',
  VAGUE_INVALID_TRANSITION: '当前条目状态不允许该操作',
  AUDIO_NOT_FOUND: '音频不存在',
  UPLOAD_TYPE_NOT_ALLOWED: '不支持的音频格式',
  UPLOAD_TOO_LARGE: '音频文件超出大小限制',
  ASR_UNAVAILABLE: '语音转写服务当前不可用，请改为人工录入',
  VALIDATION_FAILED: '提交的数据不合法',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务器内部错误',
};

/** 所有业务错误都通过它抛出，保证响应体结构统一 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code] ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_CODES[code] ?? 500;
    this.details = details;
  }
}

export const notFound = (what = '资源') =>
  new ApiError('RESOURCE_NOT_FOUND', `${what}不存在或已被删除`);
