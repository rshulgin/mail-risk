import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One project per workspace so each can pick its own environment: the node
 * packages run headless, `apps/web` runs under jsdom.
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
        // The web project needs a DOM and React's JSX transform, so it carries
        // its own plugin set rather than sharing the node projects' config.
        plugins: [react()],
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
