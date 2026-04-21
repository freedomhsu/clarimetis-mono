/**
 * Playwright globalSetup — runs in the MAIN process before any workers are
 * spawned. Setting process.env here propagates to every worker process via
 * fork inheritance, unlike the project-based "setup" which only affects its
 * own worker.
 *
 * clerkSetup() fetches a short-lived testing token from Clerk's API and writes
 * it to process.env.CLERK_TESTING_TOKEN.  Every subsequent call to
 * setupClerkTestingToken({ page }) in test fixtures reads that env var to
 * register the route interceptor that bypasses Clerk bot-protection.
 */

import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  await clerkSetup();
}
