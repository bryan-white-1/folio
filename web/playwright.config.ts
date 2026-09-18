import { defineConfig } from '@playwright/test';
const production = process.env.FOLIO_TEST_PRODUCTION === '1';
const baseURL = production ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './tests/ui', fullyParallel: false,
  use: { baseURL, viewport: { width: 1060, height: 900 }, launchOptions: { channel: 'msedge' } },
  webServer: { command: production ? 'npx vite preview --host 127.0.0.1 --port 5174' : 'npm run dev -- --port 5173', url: baseURL, reuseExistingServer: !production },
});
