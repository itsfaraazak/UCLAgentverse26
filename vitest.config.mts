import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // `lib/` is framework-free and must stay testable in a plain node env.
    // Component tests opt into jsdom with a `// @vitest-environment jsdom`
    // pragma at the top of the file.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
  },
});
