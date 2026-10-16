import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dedicated config for the Firestore Rules emulator tests. Kept separate from
// vite.config.ts so the React plugin / app aliases don't load for node tests.

// The repo has two copies of firebase-admin: the root one (used by scripts/tests) and functions/node_modules (the one
// the deployed Cloud Functions use). functions/src/orgWrites.ts creates `FieldValue.delete()` sentinels from ITS copy; if
// the test's Firestore comes from the other copy, Firestore rejects them ("Couldn't serialize object of type
// DeleteTransform"). Point every `firebase-admin/*` import at the functions copy when it is installed so both agree.
const here = path.dirname(fileURLToPath(import.meta.url));
const fnAdmin = path.join(here, 'functions', 'node_modules', 'firebase-admin');
const alias = existsSync(path.join(fnAdmin, 'lib', 'firestore', 'index.js'))
  ? [
      { find: /^firebase-admin\/firestore$/, replacement: path.join(fnAdmin, 'lib', 'firestore', 'index.js') },
      { find: /^firebase-admin\/app$/, replacement: path.join(fnAdmin, 'lib', 'app', 'index.js') },
    ]
  : [];

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
