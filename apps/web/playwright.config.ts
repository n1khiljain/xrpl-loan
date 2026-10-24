import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end against local anvil, local Supabase with the mock adapters, and the static export
 * (e2e/global-setup.ts starts or reuses each). One worker: the tests share a chain.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
