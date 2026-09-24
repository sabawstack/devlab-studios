import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // Playwright's 30s default was written for page interactions, not for a
  // tournament suite where a single test plays a whole bracket -- ~2n matches,
  // each a dozen or more HTTP round-trips against a local wrangler dev worker.
  // Those tests were passing on a quiet machine and timing out on a busy one,
  // which is a flaky suite pretending to be a failing one.
  timeout: 180_000,
  // `timeout` above is the TEST budget; each individual `expect` still had
  // Playwright's 5s default, which is a different and much tighter clock.
  //
  // Every operator page is a `client:only` React island: navigating to one
  // means downloading the bundle, hydrating, THEN fetching its data before
  // anything renders. On a cold worker that routinely passes 5s, so the first
  // assertion after a `page.goto` failed roughly one run in three while the
  // page itself was perfectly healthy. That is the whole of this suite's
  // long-standing "known flaky" set -- the check-in list and players list
  // tests -- not three unrelated bugs.
  //
  // 15s is still an order of magnitude under the test budget, so a page that
  // genuinely never renders still fails fast rather than hanging.
  expect: { timeout: 15_000 },
  use: {
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The fixture step must complete before wrangler dev opens the local D1
      // SQLite file — writing to it from a second process while miniflare has
      // it open can drop in-flight connections. See the script's header.
      command:
        'node scripts/pickleball/apply-e2e-fixtures.mjs && node scripts/mailbox/apply-e2e-fixtures.mjs && npx wrangler dev --port 8787 --local',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'static',
      testMatch: /(public-pages|contact-form|image-weight)\.spec\.js/,
      use: { baseURL: 'http://localhost:4173' },
    },
    {
      name: 'worker',
      // The Lead CRM suite belongs to the `worker` project, not `static`: it
      // signs in, calls `/api/admin/*`, and exercises `/r/:token` — all of
      // which need the wrangler dev worker with its D1 binding rather than the
      // preview server.
      testMatch: [
        /admin\.spec\.js/,
        /digest\.spec\.js/,
        /lead-crm\.spec\.js/,
        // The mailbox suite signs in and calls /api/admin/mailbox/* and
        // /api/mailbox/*, so it needs the wrangler dev worker with its D1
        // binding rather than the static preview server.
        /mailbox\.spec\.js/,
        /pickleball[\\/].*\.spec\.js/,
      ],
      use: { baseURL: 'http://localhost:8787' },
    },
    {
      name: 'desktop-safari',
      testMatch: /(public-pages|contact-form|image-weight)\.spec\.js/,
      use: { baseURL: 'http://localhost:4173', ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /(public-pages|contact-form|image-weight)\.spec\.js/,
      use: { baseURL: 'http://localhost:4173', ...devices['iPhone 14'] },
    },
  ],
})
