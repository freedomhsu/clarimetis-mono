/**
 * Extended Playwright test fixture.
 *
 * Wraps every `page` with `setupClerkTestingToken` so Clerk's bot-protection
 * is bypassed for the FAPI refresh requests that happen on each page load.
 * Without this, Clerk's JS SDK invalidates the saved session and redirects to
 * sign-in even when valid cookies are present in the storage state.
 *
 * Usage: import { test, expect } from "./fixtures" in any authenticated spec.
 * auth.spec.ts keeps its own unauthenticated context and imports directly from
 * @playwright/test.
 */

import { test as baseTest, expect } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";

// Ensure CLERK_TESTING_TOKEN is set in this worker process.
// globalSetup doesn't propagate process.env changes to forked workers reliably,
// so we call clerkSetup() here. It's idempotent — safe to call multiple times.
let clerkSetupDone = false;

export const test = baseTest.extend({
  page: async ({ page }, use) => {
    if (!clerkSetupDone) {
      await clerkSetup();
      clerkSetupDone = true;
    }
    await setupClerkTestingToken({ page });
    await use(page);
  },
});

export { expect };
