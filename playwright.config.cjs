const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.cjs',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  // 默认跟随系统的动画偏好（no-preference），让爆炸、压缩、浮字这些真实动画路径都进入
  // 测试范围；需要减少动效语义的用例在各自用例里用 page.emulateMedia 声明。
  use: { baseURL: 'http://127.0.0.1:8000', trace: 'retain-on-failure' },
  webServer: {
    command: 'python3 -m http.server 8000 --bind 0.0.0.0',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
