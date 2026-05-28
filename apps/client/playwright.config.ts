import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  // Real e2e suite (S26 #28) will boot gateway + channel + Postgres + Redis.
  // For S00 the suite is empty; once tests land they will manage their own
  // webServer config here.
});
