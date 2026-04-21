import { test as setup } from "@playwright/test";
import { clerkSetup, clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error("Set TEST_USER_EMAIL and TEST_USER_PASSWORD before running e2e tests.");
  }

  await clerkSetup();

  // Navigate to the sign-in page so Clerk JS loads, then inject the testing
  // token so server-side middleware trusts the programmatic session.
  await page.goto("/sign-in");
  await setupClerkTestingToken({ page });

  await clerk.signIn({ page, signInParams: { strategy: "password", identifier: email, password } });

  // clerk.signIn() internally navigates to afterSignInUrl (/dashboard).
  // Just wait for it — don't call page.goto() which would start a fresh
  // navigation and lose the testing token cookie.
  await page.waitForURL(/\/(dashboard|chat)/, { timeout: 30000 });

  await page.context().storageState({ path: AUTH_FILE });
});
