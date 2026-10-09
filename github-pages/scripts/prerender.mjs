// Turns the standalone SEO pages into static HTML GitHub Pages can serve.
//
// Runs after both Vite builds (see "build" in package.json):
//   dist/pages.html            client template with hashed asset links
//   dist-ssr/entry-server.js   renders a page's <head> tags and body markup
// For each page it writes dist/<slug>/index.html, then regenerates
// dist/sitemap.xml and removes the template and the SSR bundle.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const ssrDir = path.join(root, 'dist-ssr');
const templatePath = path.join(distDir, 'pages.html');

const { seoPages, pageLinks, renderPage, canonicalUrl, SITE_URL } = await import(
  pathToFileURL(path.join(ssrDir, 'entry-server.js')).href
);

// links.ts (used by the home page) and the content registry must list the
// same slugs, or the footer links a page that was never built.
const contentSlugs = seoPages.map((p) => p.slug).sort();
const linkSlugs = pageLinks.map((l) => l.slug).sort();
if (JSON.stringify(contentSlugs) !== JSON.stringify(linkSlugs)) {
  throw new Error(
    `pages/links.ts and pages/index.ts disagree.\n  links:   ${linkSlugs.join(', ')}\n  content: ${contentSlugs.join(', ')}`,
  );
}

const template = fs.readFileSync(templatePath, 'utf8');
for (const marker of ['<!--page-head-->', '<!--page-slug-->', '<!--page-body-->']) {
  if (!template.includes(marker)) throw new Error(`pages.html is missing ${marker}`);
}

for (const page of seoPages) {
  const { head, body } = renderPage(page);
  const html = template
    .replace('<!--page-head-->', () => head)
    .replace('<!--page-slug-->', () => page.slug)
    .replace('<!--page-body-->', () => body);
  const outDir = path.join(distDir, page.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`prerendered /${page.slug}/`);
}

const today = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: SITE_URL, lastmod: today, priority: '1.0' },
  ...seoPages.map((p) => ({ loc: canonicalUrl(p), lastmod: p.updated, priority: '0.8' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemap);
console.log(`sitemap.xml: ${urls.length} URLs`);

fs.rmSync(templatePath);
fs.rmSync(ssrDir, { recursive: true, force: true });
