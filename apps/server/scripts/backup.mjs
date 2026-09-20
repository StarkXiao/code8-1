#!/usr/bin/env node
/**
 * 数据备份：把数据库文件与整份音频目录打包成一个带时间戳的压缩包。
 *
 * 用法：npm run backup
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadRootEnv, resolveSqliteFile, resolveFromRepoRoot, ensureDir, repoRoot } from './env.mjs';

loadRootEnv();

const backupDir = ensureDir(resolveFromRepoRoot(process.env.BACKUP_DIR || './data/backups'));
const storageDir = resolveFromRepoRoot(process.env.STORAGE_DIR || './data/audio');
const dbFile = resolveSqliteFile();

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const staging = ensureDir(path.join(backupDir, `.staging-${stamp}`));

const manifest = { createdAt: new Date().toISOString(), database: null, audio: null };

function copyInto(source, targetRel) {
  const target = path.join(staging, targetRel);
  ensureDir(path.dirname(target));
  fs.cpSync(source, target, { recursive: true });
}

if (dbFile && fs.existsSync(dbFile)) {
  copyInto(dbFile, 'database/app.db');
  manifest.database = { file: 'database/app.db', sizeBytes: fs.statSync(dbFile).size };
} else {
  console.warn('! 未找到数据库文件，将只备份音频。');
}

if (storageDir && fs.existsSync(storageDir)) {
  copyInto(storageDir, 'audio');
  manifest.audio = { file: 'audio/', entries: fs.readdirSync(storageDir).length };
} else {
  console.warn('! 未找到音频目录，将只备份数据库。');
}

fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const archive = path.join(backupDir, `froa-backup-${stamp}.tar.gz`);
const result = spawnSync('tar', ['-czf', archive, '-C', staging, '.'], { stdio: 'inherit' });

fs.rmSync(staging, { recursive: true, force: true });

if (result.status !== 0) {
  console.error('\n✖ 打包失败（需要系统提供 tar 命令）。');
  process.exit(1);
}

console.log(`\n✔ 备份完成：${path.relative(repoRoot, archive)}`);
console.log(`  大小：${(fs.statSync(archive).size / 1024 / 1024).toFixed(2)} MB`);
