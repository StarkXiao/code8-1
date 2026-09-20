import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env, ensureDir } from '../../config/env';
import { ApiError } from '../../lib/errors';

export interface StoredObjectStat {
  sizeBytes: number;
}

/**
 * 存储驱动抽象。
 * 默认 local（本地磁盘，零依赖）；配置 STORAGE_DRIVER=s3 时可在不改业务代码的前提下替换。
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<StoredObjectStat>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** 本地驱动返回绝对路径，便于用 sendFile 做 Range 流式传输；远端驱动返回 null */
  absolutePath(key: string): string | null;
}

/** 防止 key 逃逸出存储目录 */
function safeJoin(root: string, key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) {
    throw new ApiError('VALIDATION_FAILED', '非法的存储路径');
  }
  return target;
}

class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';

  constructor(private readonly root: string) {
    ensureDir(this.root);
  }

  absolutePath(key: string): string {
    return safeJoin(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.absolutePath(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }

  async read(key: string): Promise<Buffer> {
    return fsp.readFile(this.absolutePath(key));
  }

  async stat(key: string): Promise<StoredObjectStat> {
    const stat = await fsp.stat(this.absolutePath(key));
    return { sizeBytes: stat.size };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.absolutePath(key), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fsp.unlink(this.absolutePath(key));
    } catch {
      /* 文件不存在视为已删除 */
    }
  }
}

/**
 * S3 兼容驱动的占位实现。
 * 未配置 @aws-sdk/client-s3 时给出明确报错，而不是静默降级 —— 静默降级会丢音频。
 */
class S3StorageDriver implements StorageDriver {
  readonly name = 's3';

  private notConfigured(): never {
    throw new ApiError(
      'INTERNAL_ERROR',
      'STORAGE_DRIVER=s3 需要先安装 @aws-sdk/client-s3 并配置 S3_* 环境变量。' +
        '若只想本机运行，请把 STORAGE_DRIVER 设为 local。',
    );
  }

  put(): Promise<void> {
    return this.notConfigured();
  }
  read(): Promise<Buffer> {
    return this.notConfigured();
  }
  stat(): Promise<StoredObjectStat> {
    return this.notConfigured();
  }
  exists(): Promise<boolean> {
    return this.notConfigured();
  }
  remove(): Promise<void> {
    return this.notConfigured();
  }
  absolutePath(): string | null {
    return null;
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!driver) {
    driver = env.storageDriver === 's3' ? new S3StorageDriver() : new LocalStorageDriver(env.storageDir);
  }
  return driver;
}

/** 测试用：重置驱动单例 */
export function resetStorage(): void {
  driver = null;
}

/**
 * 音频对象在存储中的 key 结构：
 *   <workspaceId>/<yyyy>/<mm>/<audioId><ext>
 * 按空间分目录，便于整空间导出与备份。
 */
export function buildAudioKey(workspaceId: string, audioId: string, extension: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${workspaceId}/${yyyy}/${mm}/${audioId}${extension}`;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/x-m4a': '.m4a',
};

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? '.bin';
}
