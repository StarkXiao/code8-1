import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** apps/server */
export const serverRoot = path.resolve(here, '..', '..');
/** 仓库根目录 origin/ */
export const repoRoot = path.resolve(serverRoot, '..', '..');

// .env 统一放在仓库根目录。
//
// 优先级：真实环境变量 > .env.local > .env
// 因此这里必须用 override:false —— 否则进程里显式传入的 DATABASE_URL
// （测试、Docker、CI 都会这么传）会被文件里的默认值悄悄覆盖。
for (const file of [path.join(repoRoot, '.env.local'), path.join(repoRoot, '.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}

const DEFAULT_DATABASE_URL = 'file:./data/app.db';

/** 相对路径一律相对仓库根目录解析，避免 cwd 不同导致数据写到别处 */
export function resolveFromRepoRoot(maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(repoRoot, maybeRelative);
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const rawDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

/**
 * 把 DATABASE_URL 归一化成 Prisma 能直接用的值。
 * SQLite 的相对路径会先转成绝对路径 —— 因为 Prisma 会把相对 SQLite 路径
 * 解析到 schema.prisma 所在目录，那与本项目的约定不一致。
 */
function normalizeDatabaseUrl(url: string): string {
  if (!url.startsWith('file:')) return url;
  const raw = url.slice('file:'.length);
  return `file:${resolveFromRepoRoot(raw)}`;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type AsrProviderName = 'manual' | 'whisper-local' | 'openai';
export type StorageDriverName = 'local' | 's3';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: toInt(process.env.PORT, 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  webDistDir: resolveFromRepoRoot(process.env.WEB_DIST_DIR ?? 'apps/web/dist'),

  databaseUrl: normalizeDatabaseUrl(rawDatabaseUrl),
  isSqlite: rawDatabaseUrl.startsWith('file:'),

  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',

  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as StorageDriverName,
  storageDir: resolveFromRepoRoot(process.env.STORAGE_DIR ?? './data/audio'),
  maxUploadMb: toInt(process.env.MAX_UPLOAD_MB, 100),

  asrProvider: (process.env.ASR_PROVIDER ?? 'manual') as AsrProviderName,
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1',
  whisperBin: process.env.WHISPER_BIN ?? 'whisper',
  whisperModel: process.env.WHISPER_MODEL ?? 'base',

  backupDir: resolveFromRepoRoot(process.env.BACKUP_DIR ?? './data/backups'),
  integrityScanIntervalMin: toInt(process.env.INTEGRITY_SCAN_INTERVAL_MIN, 0),

  /** 前端构建产物是否存在 —— 决定是否启用静态托管 */
  get hasWebBuild(): boolean {
    return fs.existsSync(path.join(this.webDistDir, 'index.html'));
  },
} as const;

if (env.isProduction && env.jwtSecret.includes('change-me')) {
  // 不直接退出，避免容器编排因环境变量顺序问题起不来，但必须显式告警
  console.warn('[warn] 生产环境仍在使用默认 JWT_SECRET，请立即更换为强随机值。');
}
