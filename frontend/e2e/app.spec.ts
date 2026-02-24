import { test, expect } from "@playwright/test";

test.describe("App loading", () => {
  test("renders the DarkPool header", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("nav")).toBeVisible();
    // Nav contains "DarkPool" branding split into two spans
    await expect(page.locator("nav >> text=Dark").first()).toBeVisible();
    await expect(page.locator("nav >> text=Pool").first()).toBeVisible();
  });

  test("shows wallet connect buttons", async ({ page }) => {
    await page.goto("/");
    // starknet-react renders connector buttons when not connected
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
    // The connect buttons or the wallet-related UI should be in the nav
    await expect(nav.locator("button").first()).toBeVisible();
  });

  test("renders the footer", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.locator("text=Sealed prediction markets on Starknet")
    ).toBeVisible();
    await expect(page.locator("text=Privacy Track")).toBeVisible();
  });

  test("shows BTC/USD price ticker area in nav", async ({ page }) => {
    await page.goto("/");
    // The PriceTicker component is in the nav
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
    // Should show BTC label or loading state
    await expect(
      nav.locator("text=BTC").or(nav.locator("text=..."))
    ).toBeVisible();
  });

  test("renders My Bets section placeholder (no wallet)", async ({ page }) => {
    await page.goto("/");
    // MyBets returns null when no wallet connected, so it should not be visible
    await expect(page.locator("text=My Bets")).not.toBeVisible();
  });

  test("renders How It Works section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=How It Works")).toBeVisible();
  });
});
