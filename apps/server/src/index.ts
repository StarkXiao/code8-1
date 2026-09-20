import http from 'node:http';
import path from 'node:path';
import { createApp } from './app';
import { env, ensureDir } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './db/client';
import { createSocketServer } from './realtime/socket';
import { startIntegritySchedule } from './services/integrity';
import { storage } from './services/storage';

async function main() {
  // 提前建好数据目录，让首次启动不依赖任何手工步骤
  ensureDir(env.storageDir);
  ensureDir(env.backupDir);
  // 数据库文件的父目录也要先建好。用 path.dirname 而不是字符串替换：
  // 替换写法在 DATABASE_URL 不含目录时（例如 file:app.db）会把文件当成目录建出来。
  if (env.isSqlite) {
    const dbFile = env.databaseUrl.replace(/^file:/, '');
    ensureDir(path.dirname(dbFile));
  }

  // 数据库连通性自检：失败就带着清晰提示退出，而不是等第一个请求才报错
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error(
      { err: error },
      '无法连接数据库。请先执行 npm run db:migrate（生成并初始化数据库文件）',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  const integrityTimer = startIntegritySchedule(env.integrityScanIntervalMin);
  if (integrityTimer) {
    logger.info(
      { intervalMinutes: env.integrityScanIntervalMin },
      '已开启音频完整性定时巡检',
    );
  }

  server.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        mode: env.nodeEnv,
        database: env.isSqlite ? 'sqlite' : 'external',
        storageDriver: storage().name,
        asrProvider: env.asrProvider,
        web: env.hasWebBuild ? env.webDistDir : '未构建（仅 API 模式，前端请用 npm run dev:web）',
      },
      '家庭食谱口述整理器服务已启动',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到退出信号，正在优雅关闭');

    // 兜底：无论下面哪一步卡住，5 秒后都必须退出。
    // 否则残留进程会一直占着端口，下次启动就会莫名其妙失败。
    const forceExit = setTimeout(() => {
      logger.warn('优雅关闭超时，强制退出');
      process.exit(0);
    }, 5000);
    forceExit.unref();

    if (integrityTimer) clearInterval(integrityTimer);

    // 必须先关 Socket.IO：它持有长连接，只调 server.close() 会一直等这些连接自己断开，
    // 结果就是"服务关了但端口还占着"。io.close() 会一并关闭底层 HTTP server。
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });

    server.close();
    await prisma.$disconnect().catch(() => undefined);

    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error({ err: error }, '服务启动失败');
  process.exit(1);
});
