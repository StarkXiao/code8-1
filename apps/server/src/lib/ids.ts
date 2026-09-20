import crypto from 'node:crypto';

/** 主键：标准 UUID，便于跨库迁移与日志追踪 */
export function newId(): string {
  return crypto.randomUUID();
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0O1I

/** 家庭空间邀请码：8 位无歧义大写字符 */
export function newInviteCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length];
  }
  return out;
}

export function sha256(buffer: Buffer | string): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
