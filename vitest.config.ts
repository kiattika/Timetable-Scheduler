import { defineConfig } from 'vitest/config';

// Dedicated config for the Firestore Rules emulator tests. Kept separate from
// vite.config.ts so the React plugin / app aliases don't load for node tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
