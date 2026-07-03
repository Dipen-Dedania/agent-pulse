import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Nested patterns keep vitest out of compiled output in agent worktrees
    // (.claude/worktrees/*/dist) and the github-pages subpackage's own
    // node_modules — both contain files that match the test glob but can't
    // run under this config.
    exclude: ['**/dist/**', '**/node_modules/**', '.claude/**', 'github-pages/**'],
    // 5s (vitest default) is tight for the installer tests that do real
    // filesystem work in a per-test temp directory. Windows CI runners
    // occasionally hit the limit even though dev boxes finish in ~1s.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      // Allow renderer imports like '../../common/types' to resolve
      '@common': path.resolve(__dirname, 'src/common'),
    },
  },
});
