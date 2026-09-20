import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..', '..');

/**
 * 测试前准备一个全新的 SQLite 库。
 * 复用与生产完全相同的迁移脚本，确保"测试跑得通"等价于"迁移没问题"。
 */
export default function setup() {
  const dataDir = path.join(repoRoot, 'data');
  for (const target of ['test.db', 'test.db-wal', 'test.db-shm', 'test-audio']) {
    fs.rmSync(path.join(dataDir, target), { recursive: true, force: true });
  }

  const result = spawnSync('node', [path.join(serverRoot, 'scripts', 'migrate.mjs')], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: 'file:./data/test.db',
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`测试数据库迁移失败：\n${result.stdout}\n${result.stderr}`);
  }
}
