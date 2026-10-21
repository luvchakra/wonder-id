import { test, expect } from "@playwright/test";

/**
 * WonderID's careers page (owner request, 2026-10-21): open positions come from WonderJobs. Without
 * WONDERJOBS_CAREERS_KEY (the E2E deployment) the page must say positions can't be shown, never invent any.
 */
test.describe("careers (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing page has a Careers section and /careers opens without a session", async ({ page }) => {
    await page.goto("/#careers");
    const careers = page.locator("#careers");
    await expect(careers.getByRole("heading", { name: "Build identity security with us." })).toBeVisible();
    await page.goto("/careers");
    await expect(page).toHaveURL(/\/careers$/);
    await expect(page.getByRole("heading", { name: "Help govern every identity." })).toBeVisible();
    // Either real positions from WonderJobs, or the honest empty/unavailable state.
    await expect(page.getByRole("link", { name: /View & apply/ }).first().or(page.getByText(/can’t be shown right now|no open positions right now/))).toBeVisible();
  });

  test("a status link without a valid token says it can't find the application", async ({ page }) => {
    await page.goto("/careers/status?t=not-a-token");
    await expect(page.getByRole("heading", { name: "We couldn't find that application." })).toBeVisible();
  });
});
