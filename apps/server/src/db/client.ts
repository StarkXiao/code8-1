import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Prisma Client 单例。
 *
 * 这里显式传入 datasources.db.url：配置里的 SQLite 路径已经在 env.ts 中
 * 转成了绝对路径，避免 Prisma 把相对路径解析到 schema 目录造成"写错文件"。
 */
declare global {
  // eslint-disable-next-line no-var
  var __froaPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: env.databaseUrl } },
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });
  return client;
}

export const prisma: PrismaClient = globalThis.__froaPrisma ?? createClient();

if (!env.isProduction) globalThis.__froaPrisma = prisma;
