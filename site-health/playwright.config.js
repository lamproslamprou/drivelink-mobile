// Runs against the LIVE site as a phone on a slow-ish connection, because the
// sign-in bug of Nov 2026 only appeared when a visitor tapped before the page
// had finished loading — something a fast desktop test never reproduces.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 1, // one retry absorbs a transient network blip; a real bug fails twice
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Pixel 7"],
    baseURL: process.env.SITE_URL || "https://drivelink.deals",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
