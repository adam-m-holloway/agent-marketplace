// Browser checks for the catalogue site, in light and dark color schemes.
//
// Built site (default): serves SITE_DIR (default <repo>/_site, from `npm run build-site -- --out _site`) on
// 127.0.0.1:4173 with python3's static server, then runs the specs against it.
//   cd .github/playwright && npm ci && npx playwright install chromium && npx playwright test
// Live site:
//   BASE_URL=https://adam-m-holloway.github.io/agent-marketplace/ npx playwright test
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4173;
const live = process.env.BASE_URL;
const siteDir = process.env.SITE_DIR ? resolve(process.env.SITE_DIR) : fileURLToPath(new URL('../../_site', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: live ?? `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1280, height: 1600 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1600 }, colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1600 }, colorScheme: 'dark' } },
  ],
  webServer: live ? undefined : {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory "${siteDir}"`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'ignore', // python's per-request access log
  },
});
