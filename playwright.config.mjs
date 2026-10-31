import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui.spec.mjs", "bridge-ui.spec.mjs", "minutes-workspace-ui.spec.mjs"],
  timeout: 65000,
  expect: { timeout: 10000 },
  workers: 1,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4317", channel: "msedge", headless: true, viewport: { width: 1440, height: 1100 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: "list"
});
