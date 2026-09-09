import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Browser-backed tests start a real server and browser; keep them off the
    // default 5s budget.
    testTimeout: 30_000,
  },
});
