import { defineConfig } from '@playwright/test'
import { PLAYGROUND_URL } from './e2e/env.ts'

// The Nooted server and the playground are started by e2e/global-setup.ts, not by
// Playwright's `webServer` (which starts before global setup, and the playground needs
// the project key that setup creates).
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // The tests share one server and one project; they are independent but sign-ins are slow enough
  // that more workers would not pay off.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: PLAYGROUND_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
