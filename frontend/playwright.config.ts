import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BACKEND_PORT_ENV,
  DEV_HOST,
  FRONTEND_PORT_ENV,
  resolvePorts,
} from '../scripts/dev-ports.mjs'

// The E2E suite *binds* both ports — it starts the frontend and the backend
// itself — so it allocates both rather than discovering them (design.md
// Decision 5). Resolution happens here, before either `webServer` command runs,
// so `baseURL`, the readiness URLs, and the two child processes all agree on
// the same pair of numbers.
const ports = await resolvePorts()

const frontendOrigin = `http://${DEV_HOST}:${ports.frontend}`
const backendOrigin = `http://${DEV_HOST}:${ports.backend}`
const e2eDataDir = join(tmpdir(), `learn-nodes-e2e-${Date.now()}-${ports.backend}`)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker, and the constraint is the backend's, not Playwright's: the
  // active account is a single pointer in the backend's secret store, shared
  // by every worker talking to the one server this config starts. Two workers
  // signing in as different accounts would each be overwriting the other's
  // session between navigations, and the account tests would fail — or worse,
  // pass — for reasons no trace could explain. A per-worker backend would buy
  // the parallelism back; until then, slow and deterministic.
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: frontendOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Both servers are managed here so `pnpm exec playwright test` is
  // self-contained: the E2E suite asserts the browser can actually reach the
  // API, so a backend must be running for the run to be meaningful.
  //
  // `reuseExistingServer` is false on both entries. Allocation already proved
  // these ports free, so anything listening on one is by definition an
  // unrelated process — attaching to it is what turned a foreign container on
  // the old default port into a reported product bug (design.md Decision 7).
  // The suite always owns its processes.
  //
  // The backend is listed first on purpose: Playwright brings these up in
  // order, and Vite *discovers* the backend at config load by verifying
  // `/health`. A Vite that starts first finds nothing to verify and falls back
  // to the default port — which, in exactly the scenario this change exists to
  // fix, is the port the unrelated process is holding. Starting the backend
  // first means Vite's verification succeeds against our own server.
  webServer: [
    {
      // The backend launcher lives at the repo root and binds the port it is
      // handed, recording it for any separately launched consumer.
      command: 'node scripts/backend.mjs',
      cwd: '..',
      url: `${backendOrigin}/health`,
      reuseExistingServer: false,
      env: {
        [BACKEND_PORT_ENV]: String(ports.backend),
        LEARN_NODES_DATA_DIR: e2eDataDir,
        // Every workspace route refuses without an active account, and the
        // only sign-in a browser can complete unattended is this one — a
        // hosted provider's consent screen is not automatable. The gate is
        // opened here, for a server this file starts and owns, rather than in
        // any committed default: a distributed build that carried it would
        // enrol accounts on demand with no credentials at all.
        LEARN_NODES_DEV_AUTH: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm run dev',
      url: frontendOrigin,
      reuseExistingServer: false,
      env: {
        [FRONTEND_PORT_ENV]: String(ports.frontend),
        [BACKEND_PORT_ENV]: String(ports.backend),
      },
    },
  ],
})
