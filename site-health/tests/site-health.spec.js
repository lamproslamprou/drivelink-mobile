import { test, expect } from "@playwright/test";

// Signed-out visitor checks only. These tests never create an account, never
// type a password and never submit a real form — empty-field submits are
// rejected client-side before any request is made.

// Fast-3G-ish network and a 4x slower CPU, so loading takes long enough for a
// visitor to tap while data is still arriving (the race that broke Sign In).
async function slowPhone(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const PAGES = [
  "/", "/browse", "/signin", "/faq", "/pricing", "/features", "/about",
  "/terms", "/privacy", "/safety", "/inspectors", "/seller-toolkit", "/escrow",
  "/guides/lien-payoff-nj", "/guides/lien-payoff-pa", "/guides/lien-payoff-ny",
];

test.describe("pages load cleanly", () => {
  for (const path of PAGES) {
    test(`${path} renders, no crashes, no broken same-site assets`, async ({ page, baseURL }) => {
      const pageErrors = [];
      const badAssets = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      page.on("response", (r) => {
        const u = r.url();
        if (u.startsWith(baseURL) && r.status() >= 400 && !u.includes("/sitemap-listings")) {
          badAssets.push(`${r.status()} ${u}`);
        }
      });
      const res = await page.goto(path, { waitUntil: "load" });
      expect(res.status(), "page status").toBeLessThan(400);
      await expect.poll(async () => (await page.locator("#root").innerText()).trim().length, { message: "app rendered something" }).toBeGreaterThan(40);
      // No sideways scroll on a phone: the usual symptom of a broken layout.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(2);
      expect(pageErrors, "uncaught JS errors").toEqual([]);
      expect(badAssets, "same-site requests that failed").toEqual([]);
    });
  }
});

test("sitemaps and robots are served", async ({ request }) => {
  for (const p of ["/sitemap.xml", "/sitemap-listings.xml"]) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(200);
    expect(await r.text(), p).toContain("<urlset");
  }
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
});

test.describe("sign-in entry points work for a visitor who taps early", () => {
  // The button appears while data is still loading; tapping then is exactly
  // what used to bounce the visitor back to the page they were on.
  for (const start of ["/", "/browse"]) {
    test(`Sign In from ${start} goes to /signin and stays`, async ({ page }) => {
      await slowPhone(page);
      await page.goto(start, { waitUntil: "commit" });
      const btn = page.getByRole("button", { name: /^sign in$/i }).first();
      await btn.waitFor({ state: "visible" });
      await btn.click();
      await expect(page).toHaveURL(/\/signin/);
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await page.waitForTimeout(6000); // long enough for late data to land and re-fire the old bug
      await expect(page).toHaveURL(/\/signin/);
      await expect(page.locator('input[type="email"]')).toBeVisible();
    });
  }
});

test.describe("other early taps are not swallowed", () => {
  // Same race as Sign In: tap a button the moment it appears, while data is
  // still loading, and make sure the page actually moves and stays there.
  test("Browse Cars from / lands on /browse and stays", async ({ page }) => {
    await slowPhone(page);
    await page.goto("/", { waitUntil: "commit" });
    const btn = page.getByRole("button", { name: /browse cars/i }).first();
    await btn.waitFor({ state: "visible" });
    await btn.click();
    await expect(page).toHaveURL(/\/browse/);
    await page.waitForTimeout(6000);
    await expect(page).toHaveURL(/\/browse/);
  });

  test("Pricing from the /browse menu lands on /pricing and stays", async ({ page }) => {
    await slowPhone(page);
    await page.goto("/browse", { waitUntil: "commit" });
    const link = page.getByRole("button", { name: /^pricing$/i }).first();
    await link.waitFor({ state: "visible" });
    await link.click();
    await expect(page).toHaveURL(/\/pricing/);
    await page.waitForTimeout(6000);
    await expect(page).toHaveURL(/\/pricing/);
  });
});

test.describe("sign-in and create-account forms give visible feedback", () => {
  test("empty Sign In shows an error in view", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /^sign in$/i }).first().click(); // the tab
    await page.locator('input[type="password"] ~ button').first().click(); // the submit button
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/email and password/i);
    await expect(alert).toBeInViewport();
  });

  test("empty Create Account shows an error in view", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /^create account$/i }).first().click(); // the tab
    await page.locator('input[type="password"] ~ button').first().click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/name/i);
    await expect(alert).toBeInViewport();
  });
});

test("return-visit card reappears after reopening /browse", async ({ page }) => {
  await page.goto("/browse");
  const firstCar = page.locator(".app-grid img").first();
  test.skip((await firstCar.count()) === 0, "no active listings to open");
  await firstCar.click();
  await expect(page).toHaveURL(/\/listing\//);
  await page.goto("/browse"); // full page load = a new visit
  await expect(page.getByText(/pick up where you left off/i)).toBeVisible();
});
