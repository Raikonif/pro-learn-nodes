import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Both servers are managed here so `pnpm exec playwright test` is self-contained:
  // the E2E suite asserts the browser can actually reach the API, so a backend
  // must be running for the run to be meaningful.
  webServer: [
    {
      command: 'pnpm run dev',
      url: 'http://localhost:1420',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'uv run uvicorn main:app --host 127.0.0.1 --port 8000',
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
