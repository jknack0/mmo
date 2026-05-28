import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server-gateway',
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    globalSetup: ['./vitest.global-setup.ts'],
    // Tests touch a shared Postgres/Redis. Run serially to avoid cross-test
    // bleed inside one process; vitest runs files in parallel by default so
    // each file owns its own beforeEach truncate.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
