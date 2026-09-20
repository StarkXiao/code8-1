import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    // 测试使用独立的数据库与存储目录，绝不触碰开发数据
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./data/test.db',
      STORAGE_DIR: './data/test-audio',
      BACKUP_DIR: './data/test-backups',
      JWT_SECRET: 'test-secret-for-vitest',
      ASR_PROVIDER: 'manual',
      LOG_LEVEL: 'silent',
      INTEGRITY_SCAN_INTERVAL_MIN: '0',
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
  },
});
