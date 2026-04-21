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

  console.log("[setup] navigating to /sign-in");
  await page.goto("/sign-in");
  console.log("[setup] url after goto /sign-in:", page.url());

  await setupClerkTestingToken({ page });
  console.log("[setup] testing token injected");

  // Log cookies before sign-in
  const cookiesBefore = await page.context().cookies();
  console.log("[setup] cookies before signIn:", cookiesBefore.map(c => c.name).join(", ") || "(none)");

  await clerk.signIn({ page, signInParams: { strategy: "password", identifier: email, password } });
  console.log("[setup] clerk.signIn() completed, current url:", page.url());

  // Log cookies after sign-in
  const cookiesAfter = await page.context().cookies();
  console.log("[setup] cookies after signIn:", cookiesAfter.map(c => c.name).join(", ") || "(none)");

  // Take screenshot to see current state
  await page.screenshot({ path: "test-results/after-signin.png" });

  // Try explicit navigation now that we know the testing token and session are set
  console.log("[setup] navigating to /dashboard");
  await page.goto("/dashboard");
  console.log("[setup] url after goto /dashboard:", page.url());
  await page.screenshot({ path: "test-results/after-goto-dashboard.png" });

  await page.waitForURL(/\/(dashboard|chat)/, { timeout: 30000 });

  await page.context().storageState({ path: AUTH_FILE });
});
