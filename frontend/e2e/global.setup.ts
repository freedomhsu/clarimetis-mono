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

  // Ensure CLERK_TESTING_TOKEN is set in this worker process.
  await clerkSetup();

  // Register the FAPI route interceptor before navigation so it covers the
  // page-load FAPI requests too.
  await setupClerkTestingToken({ page });

  // Log FAPI requests to verify the testing token is being appended.
  page.on("request", (req) => {
    if (req.url().includes("clerk.accounts.dev")) {
      const url = new URL(req.url());
      const hasToken = url.searchParams.has("__clerk_testing_token");
      console.log(`[FAPI] ${req.method()} ${url.pathname} ${hasToken ? "[token ✓]" : "[NO TOKEN]"}`);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("clerk.accounts.dev")) {
      console.log(`[FAPI] ← ${res.status()} ${new URL(res.url()).pathname}`);
    }
  });

  // Load the sign-in page so window.Clerk starts initializing.
  await page.goto("/sign-in");

  // @clerk/testing's clerk.signIn() internally waits for window.Clerk.loaded
  // but NOT for window.Clerk.client (which is set after the FAPI /v1/client
  // response). If we call clerk.signIn() while Clerk.client is still null, the
  // internal h() function silently returns and the session is never created.
  // Fix: explicitly wait for Clerk.client to become non-null first.
  await page.waitForFunction(() => window.Clerk?.client != null, {
    timeout: 30_000,
    message: "Clerk.client never initialized – FAPI requests may be blocked or the testing token may be invalid",
  });

  // Now Clerk.client is ready. The emailAddress path creates a sign-in token
  // via Clerk's Backend API, exchanges it as a ticket in the browser, and
  // waits for window.Clerk.user to be set (throws on failure).
  await clerk.signIn({ page, emailAddress: email });

  // Verify the sign-in actually produced an authenticated session.
  const isSignedIn = await page.evaluate(() => window.Clerk?.user != null);
  if (!isSignedIn) {
    throw new Error(
      "clerk.signIn() completed but window.Clerk.user is still null – the session was not established."
    );
  }

  // Session cookies (__clerk_db_jwt, __client_uat) are now set on localhost.
  await page.context().storageState({ path: AUTH_FILE });
});
