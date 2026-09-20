#!/usr/bin/env node
/**
 * npm install 之后自动生成 Prisma Client。
 *
 * 没有这一步，新克隆下来的仓库跑 `npm run db:seed` 或 `npm run dev` 会直接报
 * "does not provide an export named 'PrismaClient'" —— 因为 @prisma/client
 * 必须先按 schema 生成代码才能用。
 *
 * 注意：Docker 构建的第一层只拷贝了 package.json（源码还没进来），
 * 这时 schema 不存在，脚本会安静跳过；Dockerfile 在 COPY 之后会显式再生成一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const schemaPath = path.join(serverRoot, 'prisma', 'schema.prisma');

if (!fs.existsSync(schemaPath)) {
  console.log('[postinstall] 尚未复制 prisma/schema.prisma，跳过 Prisma Client 生成。');
  process.exit(0);
}

console.log('[postinstall] 正在生成 Prisma Client …');

const result = spawnSync('npx', ['prisma', 'generate', '--schema', schemaPath], {
  stdio: 'inherit',
  cwd: serverRoot,
  // 生成阶段只读 schema，不需要真实数据库连接
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'file:./data/app.db' },
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.warn(
    '[postinstall] Prisma Client 生成失败。请手动执行：npm run db:generate\n' +
      '             若只是网络问题，重试一次通常即可。',
  );
  // 不让安装整体失败：最坏情况用户手动跑一次 db:generate 就能恢复
  process.exit(0);
}

console.log('[postinstall] Prisma Client 生成完成。');
