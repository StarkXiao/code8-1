#!/usr/bin/env node
/**
 * 生成一个新的迁移文件。
 *
 * 流程：
 *   1. 把现有 prisma/migrations 全部应用到一个临时 SQLite 影子库；
 *   2. 用 prisma migrate diff 计算「影子库 → schema.prisma」的差异 SQL；
 *   3. 写入 prisma/migrations/<timestamp>_<name>/migration.sql。
 *
 * 用法：npm --workspace @froa/server run db:migrate:new -- add_something
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { serverRoot, loadRootEnv } from './env.mjs';

loadRootEnv();

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('用法：npm --workspace @froa/server run db:migrate:new -- <snake_case_name>');
  process.exit(1);
}

const migrationsDir = path.join(serverRoot, 'prisma', 'migrations');
const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');

// 1. 构建影子库
const shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'froa-shadow-'));
const shadowFile = path.join(shadowDir, 'shadow.db');
const db = new DatabaseSync(shadowFile);
db.exec('PRAGMA foreign_keys = ON;');

const names = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  : [];

for (const dir of names) {
  const sql = fs.readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
  db.exec(sql);
}
db.close();

// 2. 计算差异
const result = spawnSync(
  'npx',
  [
    'prisma',
    'migrate',
    'diff',
    '--from-url',
    `file:${shadowFile}`,
    '--to-schema-datamodel',
    schemaPath,
    '--script',
  ],
  { encoding: 'utf8', cwd: serverRoot, shell: process.platform === 'win32' },
);

fs.rmSync(shadowDir, { recursive: true, force: true });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

const script = result.stdout.trim();

// 没有差异时，prisma migrate diff 返回的不是空字符串，而是一段
// `-- This is an empty migration.` 注释。只判空会把注释当成真实 diff，
// 于是每次调用都会产生一个空迁移文件。
const meaningfulSql = script
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
  .join('\n');

if (!meaningfulSql) {
  console.log('schema.prisma 与现有迁移没有差异，未生成新迁移。');
  process.exit(0);
}

// 3. 写入
const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .slice(0, 14);
const folder = `${stamp}_${name}`;
const target = path.join(migrationsDir, folder);
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'migration.sql'), `${script}\n`);

console.log(`✔ 已生成 prisma/migrations/${folder}/migration.sql`);
console.log('  执行 npm run db:migrate 应用该迁移。');
