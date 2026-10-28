import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    hasTouch: true,
    deviceScaleFactor: 1,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "webkit-ipad", use: { browserName: "webkit", isMobile: true } },
    { name: "chromium-tablet", use: { browserName: "chromium", isMobile: true } },
  ],
  webServer: {
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BIBLIORADAR_E2E: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_biblioradar_test",
      NEXT_PUBLIC_MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    },
  },
});
