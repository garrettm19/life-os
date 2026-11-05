import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: process.env.PLAYWRIGHT_CHROMIUM_ARGS
        ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS)
        : undefined,
    },
    baseURL: 'http://127.0.0.1:8087',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-web',
      // Dark by default; theme.spec.ts checks light as well.
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: 'node scripts/serve-preview.mjs',
    url: 'http://127.0.0.1:8087',
    reuseExistingServer: !process.env.CI,
  },
});
