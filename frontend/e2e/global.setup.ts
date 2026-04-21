import { test as setup } from "@playwright/test";
import { clerkSetup, clerk } from "@clerk/testing/playwright";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error("Set TEST_USER_EMAIL and TEST_USER_PASSWORD before running e2e tests.");
  }

  await clerkSetup();

  // Navigate to any Clerk-enabled page first so window.Clerk is loaded
  // before clerk.signIn() tries to call it.
  await page.goto("/sign-in");

  await clerk.signIn({ page, signInParams: { strategy: "password", identifier: email, password } });

  await page.goto("/dashboard");
  await page.waitForURL(/\/(dashboard|chat)/, { timeout: 30000 });

  await page.context().storageState({ path: AUTH_FILE });
});
