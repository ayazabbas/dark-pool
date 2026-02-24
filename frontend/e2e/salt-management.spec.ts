import { test, expect } from "@playwright/test";

const TEST_WALLET = "0x1234567890abcdef";
const STORAGE_KEY = `darkpool:bets:${TEST_WALLET}`;

const sampleBets = [
  {
    marketAddress: "0xabc123",
    direction: 1,
    amount: "5000000000000000000",
    salt: "0xdeadbeef1234",
    commitmentHash: "0xhash1",
    status: "committed",
    timestamp: Date.now(),
  },
  {
    marketAddress: "0xabc123",
    direction: 0,
    amount: "3000000000000000000",
    salt: "0xcafebabe5678",
    commitmentHash: "0xhash2",
    status: "revealed",
    timestamp: Date.now() - 60000,
  },
];

test.describe("Salt management via localStorage", () => {
  test("stores and retrieves bets from localStorage", async ({ page }) => {
    await page.goto("/");

    // Set bets in localStorage
    await page.evaluate(
      ({ key, bets }) => {
        localStorage.setItem(key, JSON.stringify(bets));
      },
      { key: STORAGE_KEY, bets: sampleBets }
    );

    // Verify retrieval
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    }, STORAGE_KEY);

    expect(stored).toHaveLength(2);
    expect(stored[0].salt).toBe("0xdeadbeef1234");
    expect(stored[1].direction).toBe(0);
  });

  test("export produces valid JSON with all bet fields", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(
      ({ key, bets }) => {
        localStorage.setItem(key, JSON.stringify(bets));
      },
      { key: STORAGE_KEY, bets: sampleBets }
    );

    const exported = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.stringify(JSON.parse(raw), null, 2) : "[]";
    }, STORAGE_KEY);

    const parsed = JSON.parse(exported);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty("marketAddress");
    expect(parsed[0]).toHaveProperty("salt");
    expect(parsed[0]).toHaveProperty("direction");
    expect(parsed[0]).toHaveProperty("amount");
    expect(parsed[0]).toHaveProperty("commitmentHash");
    expect(parsed[0]).toHaveProperty("status");
  });

  test("import merges new bets without duplicating", async ({ page }) => {
    await page.goto("/");

    // Store initial bet
    await page.evaluate(
      ({ key, bets }) => {
        localStorage.setItem(key, JSON.stringify([bets[0]]));
      },
      { key: STORAGE_KEY, bets: sampleBets }
    );

    // Import both (should add only the second one)
    const count = await page.evaluate(
      ({ key, bets }) => {
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        let added = 0;
        for (const bet of bets) {
          const dup = existing.some(
            (b: any) =>
              b.marketAddress === bet.marketAddress && b.salt === bet.salt
          );
          if (!dup) {
            existing.push(bet);
            added++;
          }
        }
        localStorage.setItem(key, JSON.stringify(existing));
        return added;
      },
      { key: STORAGE_KEY, bets: sampleBets }
    );

    expect(count).toBe(1);

    const final = await page.evaluate((key) => {
      return JSON.parse(localStorage.getItem(key) || "[]");
    }, STORAGE_KEY);
    expect(final).toHaveLength(2);
  });

  test("clearing localStorage removes all bets", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(
      ({ key, bets }) => {
        localStorage.setItem(key, JSON.stringify(bets));
      },
      { key: STORAGE_KEY, bets: sampleBets }
    );

    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, STORAGE_KEY);

    const stored = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, STORAGE_KEY);

    expect(stored).toBeNull();
  });
});
