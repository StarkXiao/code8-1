#!/usr/bin/env node
/**
 * Prisma CLI 包装器。
 *
 * 存在的理由：Prisma CLI 只会自动读取 cwd / schema 目录下的 .env，
 * 而本项目的 .env 统一放在仓库根目录。这里先把根 .env 载入 process.env，
 * 再转发给 prisma，保证 DATABASE_URL 等变量在 CLI 与运行时完全一致。
 *
 * 用法：node scripts/prisma-cli.mjs <prisma 子命令...>
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { serverRoot, loadRootEnv } from './env.mjs';

loadRootEnv();

const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');
const forwarded = process.argv.slice(2);

const hasSchemaFlag = forwarded.some((arg, i) => arg === '--schema' || forwarded[i - 1] === '--schema');
const args = hasSchemaFlag ? forwarded : [...forwarded, '--schema', schemaPath];

const result = spawnSync('npx', ['prisma', ...args], {
  stdio: 'inherit',
  cwd: serverRoot,
  env: process.env,
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
