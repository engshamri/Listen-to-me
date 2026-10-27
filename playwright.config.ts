import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3210);

/**
 * Browser tests. On Windows they use the installed Microsoft Edge (no browser
 * download needed). Elsewhere run `npx playwright install chromium` once, or
 * set PW_CHANNEL=chrome to use an installed Chrome.
 * The PDF import and text tools also run in WebKit with an iPhone 13 profile
 * (Safari's engine, emulated; not a physical iPhone): run
 * `npx playwright install webkit` once.
 * Requires a production build (`npm run build`).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  // Builds large PDF fixtures (a 450-page Arabic book) with the browser's print engine.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        channel: process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : undefined),
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "iphone-webkit",
      testMatch: ["pdf-import.spec.ts", "text-tools.spec.ts", "navigation.spec.ts"],
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
