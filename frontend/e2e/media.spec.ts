/**
 * E2E tests for the /media (Media Library) page.
 *
 * All backend calls are intercepted via page.route() so these tests run
 * fully offline — no real GCS, no real backend required.
 *
 * Covers:
 *  - Pro user sees the quota bar and a file card when files are returned
 *  - Pro user sees the empty-state panel when no files are returned
 *  - Quota bar reflects the actual sum of file sizes
 *  - Singular vs plural file-count label
 *  - Non-image file (PDF) shows the placeholder icon, not a broken <img>
 *  - uploaded_at: null renders "Unknown date" instead of "Invalid Date"
 *  - Delete: clicking trash shows the confirm prompt
 *  - Delete: confirming removes the card from the page and calls DELETE
 *  - Delete: cancelling leaves the card in place
 *  - Delete: backend failure shows an error banner and keeps the card
 *  - List API error (non-402) renders the error state
 *  - Free user sees the upgrade gate instead of the file list (402 from API)
 *  - Upgrade-to-Pro link points to /pricing
 *  - IDOR guard: the DELETE request URL always uses the signed-in user's
 *    blob path prefix, never another user's
 */

import { test, expect } from "./fixtures";
import { API_URL } from "./helpers";

const PRO_USER = {
  id: "u_pro",
  subscription_tier: "pro",
  email: "pro@example.com",
  full_name: "Pro User",
  storage_used_bytes: 20,
};

const FREE_USER = {
  id: "u_free",
  subscription_tier: "free",
  email: "free@example.com",
  full_name: "Free User",
  storage_used_bytes: 0,
};

const FAKE_FILE = {
  blob_path: "uploads/u_pro/abc_photo.jpg",
  filename: "photo.jpg",
  content_type: "image/jpeg",
  size_bytes: 20,
  uploaded_at: new Date().toISOString(),
  url: "https://picsum.photos/seed/test/400/300",
};

const FAKE_PDF = {
  blob_path: "uploads/u_pro/def_report.pdf",
  filename: "report.pdf",
  content_type: "application/pdf",
  size_bytes: 1024 * 1024, // 1 MB
  uploaded_at: new Date().toISOString(),
  url: "https://storage.googleapis.com/bucket/uploads/u_pro/def_report.pdf",
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Set up the /users/me intercept for PRO_USER (used by most suites). */
async function mockProUser(page: import("@playwright/test").Page) {
  await page.route(`${API_URL}/api/v1/users/me`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRO_USER) }),
  );
}

/** Set up the GET /media intercept with a fixed list of files. */
async function mockMediaList(
  page: import("@playwright/test").Page,
  files: unknown[],
) {
  await page.route(`${API_URL}/api/v1/media`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(files),
      });
    } else {
      await route.continue();
    }
  });
}

// ── Pro user with files ───────────────────────────────────────────────────────

test.describe("Media Library — Pro user with files", () => {
  test.beforeEach(async ({ page }) => {
    await mockProUser(page);
    await mockMediaList(page, [FAKE_FILE]);
  });

  test("shows the storage quota bar", async ({ page }) => {
    await page.goto("/media");

    await expect(page.getByText(/storage used/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/500 mb/i)).toBeVisible();
  });

  test("quota bar reflects the actual used bytes", async ({ page }) => {
    await page.goto("/media");

    // FAKE_FILE.size_bytes = 20 B — should show "20 B" as the used amount
    await expect(page.getByText(/storage used/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/20 b/i)).toBeVisible();
  });

  test("shows a file card with the filename and a download link", async ({ page }) => {
    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    const downloadLink = page.getByRole("link", { name: /download/i });
    await expect(downloadLink).toBeVisible();
    // Download link must point to the signed URL, not the blob path
    const href = await downloadLink.getAttribute("href");
    expect(href).toContain("picsum.photos");
  });

  test("shows singular file count label for one file", async ({ page }) => {
    await page.goto("/media");

    await expect(page.getByText(/\b1 file\b/i)).toBeVisible({ timeout: 8_000 });
    // Must NOT render "1 files"
    await expect(page.getByText(/\b1 files\b/i)).not.toBeVisible();
  });
});

// ── Multiple files ────────────────────────────────────────────────────────────

test.describe("Media Library — multiple files", () => {
  test("shows plural file count and sums sizes for quota bar", async ({ page }) => {
    await mockProUser(page);
    await mockMediaList(page, [FAKE_FILE, FAKE_PDF]);

    await page.goto("/media");

    await expect(page.getByText(/storage used/i)).toBeVisible({ timeout: 8_000 });
    // 20 B + 1 MB = "1.0 MB" used
    await expect(page.getByText(/1\.0 mb/i)).toBeVisible();
    // Plural label
    await expect(page.getByText(/\b2 files\b/i)).toBeVisible();
  });

  test("shows two file cards", async ({ page }) => {
    await mockProUser(page);
    await mockMediaList(page, [FAKE_FILE, FAKE_PDF]);

    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("report.pdf")).toBeVisible();
  });
});

// ── Non-image file (PDF) ──────────────────────────────────────────────────────

test.describe("Media Library — non-image file", () => {
  test("renders the placeholder icon for a PDF, not a broken img", async ({ page }) => {
    await mockProUser(page);
    await mockMediaList(page, [FAKE_PDF]);

    await page.goto("/media");

    await expect(page.getByText("report.pdf")).toBeVisible({ timeout: 8_000 });
    // The "Video" placeholder text is rendered for non-image files
    await expect(page.getByText(/video/i)).toBeVisible();
    // No <img> element should be present — PDFs use the icon fallback
    const img = page.locator("img");
    await expect(img).toHaveCount(0);
  });
});

// ── Null uploaded_at ──────────────────────────────────────────────────────────

test.describe("Media Library — null uploaded_at", () => {
  test("shows 'Unknown date' instead of 'Invalid Date' when uploaded_at is null", async ({
    page,
  }) => {
    await mockProUser(page);
    await mockMediaList(page, [{ ...FAKE_FILE, uploaded_at: null }]);

    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/unknown date/i)).toBeVisible();
    await expect(page.getByText(/invalid date/i)).not.toBeVisible();
  });
});

// ── Empty library ─────────────────────────────────────────────────────────────

test.describe("Media Library — Pro user empty library", () => {
  test("shows the empty-state panel when no files exist", async ({ page }) => {
    await mockProUser(page);
    await mockMediaList(page, []);

    await page.goto("/media");

    await expect(page.getByText(/no files uploaded yet/i)).toBeVisible({ timeout: 8_000 });
  });
});

// ── Delete flow ───────────────────────────────────────────────────────────────

test.describe("Media Library — delete flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockProUser(page);
    await page.route(`${API_URL}/api/v1/media`, async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([FAKE_FILE]),
        });
      } else if (method === "DELETE") {
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });
  });

  test("clicking trash shows confirm prompt", async ({ page }) => {
    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await page.getByTitle(/delete file/i).click();

    await expect(page.getByText(/delete this file\?/i)).toBeVisible();
  });

  test("confirming delete removes the card and sends DELETE request", async ({ page }) => {
    const deletedPaths: string[] = [];

    await page.route(`${API_URL}/api/v1/media/**`, async (route) => {
      if (route.request().method() === "DELETE") {
        deletedPaths.push(route.request().url());
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await page.getByTitle(/delete file/i).click();
    await expect(page.getByText(/delete this file\?/i)).toBeVisible();
    await page.getByRole("button", { name: /^yes$/i }).click();

    // Card should be removed from the DOM
    await expect(page.getByText("photo.jpg")).not.toBeVisible({ timeout: 5_000 });

    // Exactly one DELETE request must have been made
    expect(deletedPaths).toHaveLength(1);
    // IDOR check: the deleted path must include the authenticated user's prefix
    expect(deletedPaths[0]).toContain("uploads/u_pro/");
    // And must NOT contain any other user's ID
    expect(deletedPaths[0]).not.toContain("uploads/u_victim/");
  });

  test("cancelling delete leaves the card visible", async ({ page }) => {
    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await page.getByTitle(/delete file/i).click();
    await expect(page.getByText(/delete this file\?/i)).toBeVisible();
    await page.getByRole("button", { name: /^no$/i }).click();

    // Confirm prompt gone, card still present
    await expect(page.getByText(/delete this file\?/i)).not.toBeVisible();
    await expect(page.getByText("photo.jpg")).toBeVisible();
  });

  test("delete backend failure shows an error banner and keeps the card", async ({ page }) => {
    // Override the DELETE intercept from beforeEach to return a 500
    await page.route(`${API_URL}/api/v1/media/**`, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Storage error. Please try again." }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/media");

    await expect(page.getByText("photo.jpg")).toBeVisible({ timeout: 8_000 });
    await page.getByTitle(/delete file/i).click();
    await page.getByRole("button", { name: /^yes$/i }).click();

    // Error banner must appear
    await expect(page.getByText(/storage error/i)).toBeVisible({ timeout: 5_000 });
    // Card must still be present (no optimistic removal on failure)
    await expect(page.getByText("photo.jpg")).toBeVisible();
  });
});

// ── List API error ────────────────────────────────────────────────────────────

test.describe("Media Library — list API error", () => {
  test("shows an error banner when the list request fails with 500", async ({ page }) => {
    await mockProUser(page);
    await page.route(`${API_URL}/api/v1/media`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Internal server error" }),
      }),
    );

    await page.goto("/media");

    await expect(page.getByText(/internal server error/i)).toBeVisible({ timeout: 8_000 });
    // File grid and quota bar must NOT be shown
    await expect(page.getByText(/storage used/i)).not.toBeVisible();
  });
});

// ── Free user upgrade gate ────────────────────────────────────────────────────

test.describe("Media Library — free user upgrade gate", () => {
  test("shows the upgrade gate when API returns 402", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FREE_USER),
      }),
    );
    await page.route(`${API_URL}/api/v1/media`, (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "subscription_required",
            message: "This feature requires a Pro subscription.",
            upgrade_path: "/users/subscribe",
          },
        }),
      }),
    );

    await page.goto("/media");

    await expect(
      page.getByText(/media library is a pro feature/i),
    ).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("link", { name: /upgrade to pro/i })).toBeVisible();
    // File list and quota bar must NOT be visible
    await expect(page.getByText(/storage used/i)).not.toBeVisible();
  });

  test("shows the upgrade gate when API returns 429 daily_limit_reached", async ({ page }) => {
    // daily_limit_reached on the media list endpoint should also gate the UI
    // (exercises the fix that removed the .code === "subscription_required" check)
    await page.route(`${API_URL}/api/v1/users/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FREE_USER),
      }),
    );
    await page.route(`${API_URL}/api/v1/media`, (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "daily_limit_reached",
            message: "You have reached your daily limit.",
            upgrade_path: "/users/subscribe",
          },
        }),
      }),
    );

    await page.goto("/media");

    // Any subscription error gates the media library — not only subscription_required
    await expect(
      page.getByText(/media library is a pro feature|upgrade to pro/i),
    ).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/storage used/i)).not.toBeVisible();
  });

  test("upgrade-to-pro link points to /pricing", async ({ page }) => {
    await page.route(`${API_URL}/api/v1/users/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FREE_USER),
      }),
    );
    await page.route(`${API_URL}/api/v1/media`, (route) =>
      route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "subscription_required",
            message: "This feature requires a Pro subscription.",
            upgrade_path: "/users/subscribe",
          },
        }),
      }),
    );

    await page.goto("/media");

    const upgradeLink = page.getByRole("link", { name: /upgrade to pro/i });
    await expect(upgradeLink).toBeVisible({ timeout: 8_000 });
    const href = await upgradeLink.getAttribute("href");
    expect(href).toBe("/pricing");
  });
});
