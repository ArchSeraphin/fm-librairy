import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/integration/**/*.test.ts', 'tests/attacks/**/*.test.ts'],
    globalSetup: ['./tests/integration/setup/global-setup.ts'],
    setupFiles: ['./tests/integration/setup/containers.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
