import { defineConfig } from 'vitest/config';

/**
 * One project per workspace so each can pick its own environment.
 * `apps/web` joins in slice 4 with a jsdom environment.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'eval',
          root: './eval',
          environment: 'node',
          include: ['**/*.test.ts'],
        },
      },
    ],
  },
});
