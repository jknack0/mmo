import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server-channel',
    include: ['src/**/*.test.ts'],
  },
});
