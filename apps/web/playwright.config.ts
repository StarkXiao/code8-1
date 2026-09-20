import { defineConfig, devices } from '@playwright/test';

/**
 * UI 层闭环测试。
 *
 * 策略：直接测「生产构建产物 + 真实后端」，而不是 dev server。
 *  - 测的就是最终交付物本身；
 *  - 用独立端口 4100，不会和本机其它项目的 5173/4000 撞车。
 *
 * 浏览器：默认用系统已安装的 Google Chrome。
 * 若机器上没有 Chrome：先跑 npx playwright install chromium，再删掉下面的 channel: 'chrome'。
 *
 * 运行：npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: [
    {
      command: 'npm run build && npm run db:migrate && npm --workspace @froa/server run start',
      cwd: '../..',
      url: 'http://127.0.0.1:4100/api/healthz',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: '4100',
        WEB_ORIGIN: 'http://127.0.0.1:4100',
        DATABASE_URL: 'file:./data/e2e.db',
        STORAGE_DIR: './data/e2e-audio',
        BACKUP_DIR: './data/e2e-backups',
        ASR_PROVIDER: 'manual',
      },
    },
  ],
});
