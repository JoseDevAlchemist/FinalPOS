import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    channel: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
});
