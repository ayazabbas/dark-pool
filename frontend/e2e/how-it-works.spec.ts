import { test, expect } from "@playwright/test";

test.describe("How It Works accordion", () => {
  test("accordion is visible and collapsed by default", async ({ page }) => {
    await page.goto("/");
    const trigger = page.locator("text=How It Works");
    await expect(trigger).toBeVisible();
    // Content should be collapsed — step details not visible
    await expect(page.locator("text=Seal Your Bet")).not.toBeVisible();
  });

  test("clicking expands the accordion to show all steps", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.locator("text=How It Works");
    await trigger.click();
    // All 4 steps should become visible
    await expect(page.locator("text=1. Seal Your Bet")).toBeVisible();
    await expect(page.locator("text=2. Market Resolves")).toBeVisible();
    await expect(page.locator("text=3. Reveal")).toBeVisible();
    await expect(page.locator("text=4. Claim Payout")).toBeVisible();
  });

  test("expanded content shows privacy benefits", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=How It Works").click();
    await expect(page.locator("text=Why sealed bets matter")).toBeVisible();
    await expect(page.locator("text=No front-running")).toBeVisible();
    await expect(page.locator("text=No herd behavior")).toBeVisible();
    await expect(page.locator("text=No information leakage")).toBeVisible();
  });

  test("clicking again collapses the accordion", async ({ page }) => {
    await page.goto("/");
    const trigger = page.locator("text=How It Works");

    // Expand
    await trigger.click();
    await expect(page.locator("text=1. Seal Your Bet")).toBeVisible();

    // Collapse
    await trigger.click();
    await expect(page.locator("text=1. Seal Your Bet")).not.toBeVisible({
      timeout: 3000,
    });
  });

  test("accordion shows Poseidon hash explanation", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=How It Works").click();
    await expect(
      page.locator("text=sealed using a Poseidon hash")
    ).toBeVisible();
  });

  test("accordion explains parimutuel payout", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=How It Works").click();
    await expect(
      page.locator("text=Winners split the losing pool proportionally")
    ).toBeVisible();
  });
});
