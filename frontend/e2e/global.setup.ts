import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/user.json");

/**
 * Signs in once with a real Clerk test user and saves the browser storage
 * state (cookies + localStorage) so every subsequent test can reuse it
 * without going through the login flow.
 *
 * Required env vars:
 *   TEST_USER_EMAIL     — email of a Clerk user in your dev environment
 *   TEST_USER_PASSWORD  — password for that user
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set TEST_USER_EMAIL and TEST_USER_PASSWORD before running e2e tests.",
    );
  }

  await page.goto("/sign-in");

  // Clerk's embedded <SignIn /> renders a multi-step form.
  // Step 1: email/identifier
  const emailInput = page.locator('input[name="identifier"], input[type="email"]').first();
  await emailInput.waitFor({ timeout: 30_000 });
  await emailInput.fill(email);
  const continueBtn1 = page.getByRole("button", { name: /continue/i }).first();
  await continueBtn1.waitFor({ state: "visible", timeout: 10_000 });
  await continueBtn1.click();

  // Step 2: password (Clerk makes an API call between steps — allow extra time in CI)
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ timeout: 30_000 });
  await passwordInput.fill(password);
  const continueBtn2 = page.getByRole("button", { name: /continue/i }).first();
  await continueBtn2.waitFor({ state: "visible", timeout: 10_000 });
  await continueBtn2.click();

  // Wait until Clerk has completed the sign-in and Next.js has redirected
  // to a protected page (dashboard or chat).
  await page.waitForURL(/\/(dashboard|chat)/, { timeout: 30_000 });

  // Persist the authenticated browser state for all subsequent test runs.
  await page.context().storageState({ path: AUTH_FILE });
});
