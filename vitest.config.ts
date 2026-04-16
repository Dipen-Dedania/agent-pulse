import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      // Allow renderer imports like '../../common/types' to resolve
      '@common': path.resolve(__dirname, 'src/common'),
    },
  },
});
