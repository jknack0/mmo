import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.git/**'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // Load-bearing source. Excludes test files, server entrypoints/wiring,
      // migrations, the load-test CLI, and the dev-only e2e hook — none of which
      // carry unit-testable logic.
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'packages/domain/src/index.ts',      // barrel re-export only
        'apps/*/src/index.ts',               // server entrypoints (wiring)
        '**/main.tsx',
        '**/db/migrations/**',
        '**/db/migrate.ts',
        '**/db/client.ts',
        '**/loadtest/**',
        '**/e2e-hook.ts',
        '**/env.ts',
      ],
    },
  },
});
