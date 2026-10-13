import { defineConfig } from 'vitest/config';

/** Manual-only suites (a real local model): never part of `npm test` or CI. */
export default defineConfig({ test: { include: ['tests/manual/**/*.test.ts'], root: '.' } });
