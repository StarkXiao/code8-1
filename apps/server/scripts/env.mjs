/**
 * 统一的运行时路径与环境变量解析。
 *
 * 约定：DATABASE_URL / STORAGE_DIR / BACKUP_DIR 中的相对路径一律相对**仓库根目录**
 * （即 origin/）解析。这样无论从仓库根还是从 apps/server 启动，指向的都是同一份数据。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** apps/server */
export const serverRoot = path.resolve(here, '..');
/** origin/ */
export const repoRoot = path.resolve(serverRoot, '..', '..');

export function loadRootEnv() {
  // 顺序即优先级：真实环境变量 > .env.local > .env
  const candidates = [path.join(repoRoot, '.env.local'), path.join(repoRoot, '.env')];
  for (const file of candidates) {
    if (fs.existsSync(file)) loadDotenv({ path: file, override: false });
  }
  return process.env;
}

/** 把可能相对的路径解析成绝对路径 */
export function resolveFromRepoRoot(maybeRelative) {
  if (!maybeRelative) return null;
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(repoRoot, maybeRelative);
}

const DEFAULT_DB_URL = 'file:./data/app.db';

/**
 * 把 DATABASE_URL 转成 SQLite 的绝对文件路径。
 * 非 SQLite（如 postgresql://）返回 null。
 */
export function resolveSqliteFile(databaseUrl = process.env.DATABASE_URL) {
  const url = databaseUrl || DEFAULT_DB_URL;
  if (!url.startsWith('file:')) return null;
  const raw = url.slice('file:'.length);
  return resolveFromRepoRoot(raw);
}

/** 确保目录存在 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
