import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Load .env.local so TEST_USER_EMAIL / TEST_USER_PASSWORD are available
// when running locally without pre-exported env vars.
// quiet: true suppresses the dotenv v17 verbose injection log.
config({ path: ".env.local", quiet: true });

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
  globalSetup: "./e2e/clerk-global-setup",
  fullyParallel: false, // tests within a file are still sequential to keep DB clean
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 60_000, // generous timeout for CI (Clerk API + Next.js startup)

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
    // Use the Turbopack dev server — avoids a 10-15 min Next.js production
    // build and compiles pages ~5× faster than webpack on first access.
    command: "npm run dev:e2e",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
