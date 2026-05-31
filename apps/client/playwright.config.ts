import { defineConfig, devices } from '@playwright/test';

// Canonical alpha-loop e2e (S26 #28). Boots the full stack — gateway + the
// ashen-plains channel + the vite client — and drives a headless browser through
// connect → walk → attack → kill → loot → equip. Postgres + Redis are assumed up
// (docker compose) and migrated; the channel runs with CHANNEL_FORCE_DROP so loot
// is deterministic. Set E2E_SKIP_WEBSERVER=1 to point at an already-running stack.
const root = '../..';
const useExternal = process.env.E2E_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: useExternal ? undefined : [
    {
      command: `pnpm --filter @mmo/server-gateway dev`,
      cwd: root,
      port: 8080,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `ZONE_ID=ashen-plains CHANNEL_ID=ashen-ch0 CHANNEL_PORT=8081 CHANNEL_WS_URL=ws://localhost:8081 CHANNEL_FORCE_DROP=1 pnpm --filter @mmo/server-channel dev`,
      cwd: root,
      port: 8081,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @mmo/client dev`,
      cwd: root,
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
