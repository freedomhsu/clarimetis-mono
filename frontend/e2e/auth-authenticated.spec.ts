/**
 * Authenticated sign-in redirect tests.
 *
 * These tests run with the saved auth state (default storageState from
 * playwright.config.ts) and verify that an already-signed-in user is
 * immediately redirected away from the sign-in page.
 *
 * Kept in a separate file from auth.spec.ts because that file overrides
 * storageState to { cookies: [], origins: [] } for its unauthenticated tests.
 */

import { test, expect } from "./fixtures";

test.describe("Authenticated user visiting home or auth pages", () => {
  test(
    "redirects to /dashboard when visiting the home page",
    async ({ page }) => {
      await page.goto("/");
      // Confirm the redirect happened — toHaveURL matches full URL so check /dashboard directly.
      await expect(page).toHaveURL(/dashboard/, { timeout: 8_000 });
    },
  );
});

test.describe("Authenticated user visiting sign-in", () => {
  test(
    "redirects to /dashboard when no redirect_url is present",
    async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page).not.toHaveURL(/sign-in/, { timeout: 8_000 });
      await expect(page).toHaveURL(/dashboard/, { timeout: 8_000 });
    },
  );

  test(
    "redirects to redirect_url destination after Stripe payment",
    async ({ page }) => {
      const redirectTarget = "/dashboard?upgrade=success&plan=annual";
      await page.goto(`/sign-in?redirect_url=${encodeURIComponent(redirectTarget)}`);
      // Should be sent straight to /dashboard — never show the sign-in form.
      // Note: the dashboard page immediately strips ?upgrade=success from the URL
      // via window.history.replaceState so we only assert we reached /dashboard.
      await expect(page).not.toHaveURL(/sign-in/, { timeout: 8_000 });
      await expect(page).toHaveURL(/dashboard/, { timeout: 8_000 });
    },
  );
});
