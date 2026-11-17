import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    maxWorkers: 1,
    execArgv: ['--max-old-space-size=2048'],
  },
});
