import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  // Vitest would otherwise glob tests/e2e/*.spec.ts and fail on Playwright's test.describe.
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
