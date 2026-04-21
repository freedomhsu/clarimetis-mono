import { defineConfig, devices } from "@playwright/test";

/**
 * E2E test configuration.
 *
 * Prerequisites:
 *   - Backend running on http://localhost:8000  (cd backend && uvicorn app.main:app --reload)
 *   - Set TEST_USER_EMAIL and TEST_USER_PASSWORD env vars pointing at a Clerk
 *     test user that exists in the dev environment.
 *
 * Run:
 *   npm run test:e2e            # headless, single run
 *   npm run test:e2e:ui         # Playwright UI mode
 *   npm run test:e2e:headed     # visible browser
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // auth state is shared; run serially to keep DB clean
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // All tests after setup inherit this saved auth state
    storageState: "e2e/.auth/user.json",
  },

  projects: [
    // --- Phase 1: sign in once, save storage state ---
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
      use: {
        // setup runs with an explicitly empty context — not the global auth file
        storageState: { cookies: [], origins: [] },
      },
    },

    // --- Phase 2: run all specs with the saved auth state ---
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    // Start the Next.js dev server automatically.
    // The backend must be started separately (it has DB/GCP deps we can't
    // auto-start here).
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
