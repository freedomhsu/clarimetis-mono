/**
 * Subscription and quota e2e tests.
 *
 * These tests mock the backend to return 402 / 429 subscription errors and
 * verify that the UI correctly surfaces the UpgradeGate component, rolls back
 * the optimistic message, and provides upgrade CTAs.
 */

import { test, expect } from "@playwright/test";
import { API_URL, fakeSession } from "./helpers";

const SESSION_ID = "e2e-sess-sub";
const session = fakeSession({ id: SESSION_ID, title: "Sub E2E" });

const subErrorBody = (code: "daily_limit_reached" | "subscription_required") => ({
  detail: {
    code,
    message: code === "daily_limit_reached"
      ? "You have reached your daily message limit."
      : "This feature requires a Pro subscription.",
    upgrade_path: "/dashboard",
  },
});

test.beforeEach(async ({ page }) => {
  await page.route(`${API_URL}/api/v1/sessions`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([session]),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, body: "[]" });
    } else {
      await route.continue();
    }
  });

  await page.route(`${API_URL}/api/v1/users/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "u1", subscription_tier: "free", email: "t@t.com", full_name: "T" }),
    });
  });
});

test.describe("Daily limit reached (429)", () => {
  test.beforeEach(async ({ page }) => {
    // POST to messages returns 429 with structured error
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify(subErrorBody("daily_limit_reached")),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("shows the UpgradeGate with 'Daily limit reached' heading", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("one more message");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/daily limit reached/i)).toBeVisible({ timeout: 8_000 });
  });

  test("removes the optimistic user message after 429", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("should be rolled back");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for the error gate to appear (confirms the error was processed)
    await expect(page.getByText(/daily limit reached/i)).toBeVisible({ timeout: 8_000 });

    // The optimistic user message should have been removed
    await expect(page.getByText("should be rolled back")).not.toBeVisible();
  });

  test("hides MessageInput and shows upgrade pricing buttons", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/daily limit reached/i)).toBeVisible({ timeout: 8_000 });

    // UpgradeGate renders Pro Monthly and Pro Annual buttons
    await expect(page.getByRole("button", { name: /pro monthly/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /pro annual/i })).toBeVisible();

    // MessageInput (the textarea) should no longer be visible
    await expect(page.getByPlaceholder(/share what's on your mind/i)).not.toBeVisible();
  });

  test("dismissing the UpgradeGate restores MessageInput", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/daily limit reached/i)).toBeVisible({ timeout: 8_000 });

    // Click the × dismiss button on the UpgradeGate
    await page.getByRole("button", { name: /dismiss/i }).click();

    // MessageInput should be restored
    await expect(page.getByPlaceholder(/share what's on your mind/i)).toBeVisible();
  });
});

test.describe("Pro feature required (402)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 402,
          contentType: "application/json",
          body: JSON.stringify(subErrorBody("subscription_required")),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("shows 'Pro feature' heading when 402 is returned", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("pro feature test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/pro feature/i)).toBeVisible({ timeout: 8_000 });
  });

  test("also shows upgrade pricing after 402", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await page.getByPlaceholder(/share what's on your mind/i).fill("test");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(page.getByText(/pro feature/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /pro monthly/i })).toBeVisible();
  });
});

test.describe("Media upload subscription errors", () => {
  test("shows subscription error when image upload returns 402", async ({ page }) => {
    // The MediaUpload component calls POST /api/v1/media/upload
    await page.route(`${API_URL}/api/v1/media/upload`, async (route) => {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify(subErrorBody("subscription_required")),
      });
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // Trigger the file input via the MediaUpload button
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /attach/i }).click(),
    ]);
    await fileChooser.setFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-data"),
    });

    // The UpgradeGate (or error banner) should appear
    await expect(page.getByText(/pro feature|subscription required/i)).toBeVisible({
      timeout: 8_000,
    });
  });
});

// ── Media upload — happy path ─────────────────────────────────────────────

test.describe("Media upload — happy path", () => {
  const uploadedUrl = "https://storage.example.com/uploads/test.png";

  test.beforeEach(async ({ page }) => {
    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, body: "[]" });
      } else {
        await route.continue();
      }
    });

    // Successful upload returns a signed GCS URL
    await page.route(`${API_URL}/api/v1/media/upload`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: uploadedUrl, content_type: "image/png" }),
      });
    });
  });

  test("upload button opens a file chooser", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /attach/i }).click(),
    ]);

    // File chooser opened successfully
    expect(fileChooser).toBeTruthy();
  });

  test("shows a preview thumbnail after a successful upload", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /attach/i }).click(),
    ]);
    await fileChooser.setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-data"),
    });

    // The uploaded image URL should appear as a preview (img src or link)
    await expect(page.getByRole("img", { name: /photo|preview|attachment/i }).or(
      page.locator(`img[src*="storage.example.com"]`)
    )).toBeVisible({ timeout: 8_000 });
  });

  test("the media URL is included in the message when sent", async ({ page }) => {
    let sentBody: Record<string, unknown> | null = null;

    await page.route(`${API_URL}/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
      if (route.request().method() === "POST") {
        sentBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "text/plain", body: "Looks great!" });
      } else {
        await route.fulfill({ status: 200, body: "[]" });
      }
    });

    await page.goto(`/chat/${SESSION_ID}`);

    // Upload file
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /attach/i }).click(),
    ]);
    await fileChooser.setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-data"),
    });

    // Type a message and send
    await page.getByPlaceholder(/share what's on your mind/i).fill("Here is my image");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for the POST to be made
    await expect.poll(() => sentBody, { timeout: 8_000 }).not.toBeNull();

    // The request body should include the uploaded URL in media_urls
    const mediaUrls = (sentBody as { media_urls?: string[] })?.media_urls ?? [];
    expect(mediaUrls).toContain(uploadedUrl);
  });
});
