import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    // The leak test builds a fixture home folder and runs the whole collector; the bin test
    // bundles first. Both are slow on a cold Windows disk.
    testTimeout: 60_000,
  },
});
