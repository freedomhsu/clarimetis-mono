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

  // Fetch a Clerk testing token (stored in process.env.CLERK_TESTING_TOKEN) so
  // that the Clerk middleware accepts programmatic sign-ins from automated browsers.
  await clerkSetup();

  // Load the sign-in page so window.Clerk is available for clerk.signIn().
  await page.goto("/sign-in");

  // Register the FAPI route interceptor that appends the testing token to every
  // Clerk Frontend API request — bypasses bot-protection on dev instances.
  await setupClerkTestingToken({ page });

  // Programmatic sign-in via Clerk's browser client.
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier: email, password },
  });

  // Session cookies (__clerk_db_jwt, __client_uat) are now set on localhost.
  // Persist them so every subsequent test starts pre-authenticated.
  await page.context().storageState({ path: AUTH_FILE });
});
