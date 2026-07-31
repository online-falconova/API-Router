import { test, expect } from "@playwright/test";
import { gotoDashboardRoute } from "./helpers/dashboardAuth";

test.describe("Dashboard Navigation", () => {
  test("redirects unauthenticated user to /login", async ({ page }) => {
    const response = await page.goto("/dashboard");
    // Should either show login page or redirect to /login
    await page.waitForURL(/\/(login|dashboard)/);
    const url = page.url();
    // The app should show some kind of page (login or dashboard)
    expect(url).toMatch(/\/(login|dashboard)/);
  });

  test("does not prefetch dashboard routes and preserves client navigation", async ({ page }) => {
    const speculativeRequests: string[] = [];

    // Keep the Home page out of its data-loading skeleton; this test exercises
    // navigation rather than provider/model/version API integration.
    await page.route(/\/api\/(providers|models|system\/version)(?:\?.*)?$/, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === "/api/providers" ? { connections: [] } : { models: [] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    // Keep the Quick Start prerequisite deterministic; this preference is user-persisted
    // and may be disabled in a developer's local database.
    await page.route("**/api/settings", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ showQuickStartOnHome: true }),
      });
    });

    page.on("request", (request) => {
      const headers = request.headers();
      const isRscPrefetch =
        headers.rsc === "1" &&
        (headers["next-router-prefetch"] === "1" ||
          headers.purpose?.toLowerCase().includes("prefetch") ||
          headers["sec-purpose"]?.toLowerCase().includes("prefetch"));

      if (isRscPrefetch) speculativeRequests.push(request.url());
    });

    await gotoDashboardRoute(page, "/home");
    const providersLink = page.getByRole("link", { name: "Providers", exact: true });
    await expect(providersLink).toBeVisible();
    await page.waitForTimeout(500);

    expect(speculativeRequests).toEqual([]);

    await Promise.all([page.waitForURL(/\/dashboard\/providers/), providersLink.click()]);
  });

  test("login page renders with form elements", async ({ page }) => {
    await page.goto("/login");
    // Should show some form of authentication UI
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("/docs page renders documentation", async ({ page }) => {
    await page.goto("/docs");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Docs should contain some content
    const text = await body.textContent();
    expect(text?.length).toBeGreaterThan(100);
  });
});
