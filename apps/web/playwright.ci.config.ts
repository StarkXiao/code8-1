import { defineConfig, devices } from '@playwright/test';

/**
 * 无系统 Google Chrome 环境（CI 容器等）下使用的配置：
 * 改用 Playwright 自带的 chromium（先 `npx playwright install chromium`），
 * 其余行为与 playwright.config.ts 完全一致。
 *
 * 运行：npx playwright test --config playwright.ci.config.ts
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
