import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Live-network maintenance scripts, run on demand (e.g. `pnpm snapshot:evidence`), never in `pnpm test`. */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    globals: true,
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
