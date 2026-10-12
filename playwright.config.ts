// Playwright — Learnyx Math Renderer browser regression tests.
//
// Purpose (per the Tutor math-rendering reliability brief): tsc and vite
// build can both pass while students still see `S_n - rS_n &= a - ar^n \end
// {aligned}$$`. These tests open the REAL renderer in a REAL browser —
// desktop and mobile viewports — and assert what is actually painted.
//
// Run:  bunx playwright test
// The dev server is started automatically (math-harness.html entry).

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 3,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "mobile-narrow", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 700 } } },
  ],
  webServer: {
    command: "bunx vite --port 5199 --strictPort",
    url: "http://127.0.0.1:5199/math-harness.html",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
