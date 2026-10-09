import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/agent-pulse/',
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@app/*` reaches into the desktop app's source so the live demo renders
    // the real mascot components instead of copies that drift.
    alias: { '@app': fileURLToPath(new URL('../src', import.meta.url)) },
    // Those files live outside this package, so their bare imports would
    // otherwise resolve against the repo root's node_modules — a second React
    // locally, and a missing module in CI (Pages only installs this package).
    dedupe: ['react', 'react-dom', 'gsap'],
  },
  server: { fs: { allow: ['..'] } },
  build: {
    rollupOptions: {
      // pages.html is the template for the standalone SEO pages; see
      // scripts/prerender.mjs, which fills it per page and then deletes it.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        pages: fileURLToPath(new URL('pages.html', import.meta.url)),
      },
    },
  },
});
