import { defineConfig, devices } from "@playwright/test";

const port = process.env["ENA_BROWSER_PORT"] ?? "5174";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  // ponytail: the dev server, not `vite preview` — the demo page imports src
  // directly, and preview only serves the library build output.
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/demo/index.html`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
