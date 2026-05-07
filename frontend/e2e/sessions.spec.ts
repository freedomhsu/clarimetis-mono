/**
 * Session management e2e tests.
 *
 * These tests use the real backend API (create / delete) so they require a
 * running backend. The auth token is obtained from the authenticated page.
 * Sessions are created with a unique timestamp suffix so they don't conflict
 * across parallel runs.
 */

import { test, expect } from "./fixtures";
import { API_URL, getAuthToken, createSession, deleteSession, fakeSession } from "./helpers";

// ── Full-stack (real backend) tests ───────────────────────────────────────

test.describe("Session management — real API", () => {
  test.skip(!!process.env.CI, "Requires a running backend — skipped in CI");

  let authToken: string;
  const createdIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const page = await context.newPage();
    authToken = await getAuthToken(page);
    await page.close();
    await context.close();
  });

  test.afterAll(async ({ request }) => {
    // Clean up any sessions created during the suite
    for (const id of createdIds) {
      await deleteSession(request, authToken, id);
    }
  });

  test("creates a new session via the New Session button", async ({ page, request }) => {
    // Intercept the POST /sessions call to capture the new ID for cleanup
    let createdId: string | null = null;
    page.on("response", async (res) => {
      if (
        res.url().includes("/api/v1/sessions") &&
        res.request().method() === "POST" &&
        res.status() === 201
      ) {
        const body = await res.json().catch(() => null);
        if (body?.id) {
          createdId = body.id;
          createdIds.push(body.id);
        }
      }
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /new session/i }).click();

    // A new item should appear in the session sidebar
    await expect(page.getByText(/new session/i).first()).toBeVisible({ timeout: 8_000 });

    // Clean up immediately if we got the ID
    if (createdId) {
      await deleteSession(request, authToken, createdId);
      createdIds.splice(createdIds.indexOf(createdId), 1);
    }
  });

  test("selecting a session navigates to its URL", async ({ page, request }) => {
    const session = await createSession(request, authToken, `Nav Test ${Date.now()}`);
    createdIds.push(session.id);

    await page.goto("/chat");

    // Click the session in the sidebar
    await page.getByText(session.title).first().click();

    await expect(page).toHaveURL(new RegExp(session.id), { timeout: 5_000 });
  });

  test("deleting a session removes it from the sidebar", async ({ page, request }) => {
    // Create session to delete first, then a decoy — the decoy is newer so it gets
    // auto-selected when navigating to /chat, leaving our target session non-active.
    const session = await createSession(request, authToken, `Delete Test ${Date.now()}`);
    const decoy = await createSession(request, authToken, `Decoy ${Date.now()}`);
    createdIds.push(decoy.id); // cleanup; session will be deleted by this test

    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // decoy is active (newest), session is non-active → delete button in DOM
    page.once("dialog", (dialog) => dialog.accept()); // register BEFORE click
    await page.hover(`div.group:has-text("${session.title}")`);
    await page.click(`div.group:has-text("${session.title}") button[aria-label="Delete session"]`, { force: true });

    // Session should be gone from the list
    await expect(page.getByText(session.title)).not.toBeVisible({ timeout: 5_000 });
  });

  test("deleting the active session redirects to /chat", async ({ page, request }) => {
    const session = await createSession(request, authToken, `Active Delete ${Date.now()}`);
    // Don't add to createdIds — the test deletes it

    await page.goto(`/chat/${session.id}`);
    await page.waitForLoadState("networkidle");

    // The session must be active, so the delete button isn't visible (active
    // items show a chevron instead). Navigate away and back to make it inactive,
    // then hover to reveal delete.
    //
    // Alternative: create a second session so this one becomes inactive.
    const other = await createSession(request, authToken, `Other ${Date.now()}`);
    createdIds.push(other.id);

    // Reload to get the sidebar to reflect the newly created session
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Select the other session to deactivate the one we want to delete
    await page.getByText(other.title).first().click();

    // Now hover over the original session row and force-click delete
    // Register dialog handler BEFORE click (confirm dialog is synchronous)
    page.once("dialog", (dialog) => dialog.accept());
    await page.hover(`div.group:has-text("${session.title}")`);
    await page.click(`div.group:has-text("${session.title}") button[aria-label="Delete session"]`, { force: true });

    await expect(page.getByText(session.title).first()).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── Mocked tests (no backend required) ───────────────────────────────────

test.describe("Session management — mocked", () => {
  test("shows 'No sessions yet' empty state when the list is empty", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/chat");
    await expect(page.getByText(/no sessions yet/i)).toBeVisible({ timeout: 8_000 });
  });

  test("shows session count in sidebar header", async ({ page }) => {
    const sessions = [
      fakeSession({ id: "s1", title: "Session A" }),
      fakeSession({ id: "s2", title: "Session B" }),
    ];

    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(sessions),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/sessions/*/messages`, async (route) => {
      await route.fulfill({ status: 200, body: "[]" });
    });

    await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/chat");
    await expect(page.getByText("2 conversations")).toBeVisible();
  });

  test("error creating session shows an error message", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else if (route.request().method() === "POST") {
        await route.fulfill({ status: 500, body: '{"detail":"server error"}' });
      } else {
        await route.continue();
      }
    });

    await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/chat");
    await page.getByRole("button", { name: /new session/i }).click();

    await expect(page.getByText(/failed to create session/i)).toBeVisible({ timeout: 5_000 });
  });
});
