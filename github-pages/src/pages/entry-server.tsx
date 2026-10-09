/**
 * SSR entry for scripts/prerender.mjs. Built with `vite build --ssr`, it turns
 * each SeoPage into its body markup plus the <head> tags that carry the page's
 * title, canonical URL, social cards and JSON-LD.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import SeoPageView from './components/SeoPageView';
import { plainText } from './components/InlineText';
import { GROUP_LABELS, pageLinks } from './links';
import { seoPages } from './index';
import type { SeoPage } from './types';

export const SITE_URL = 'https://dipen-dedania.github.io/agent-pulse/';
const OG_IMAGE = `${SITE_URL}og-image.png`;

export { seoPages, pageLinks };

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// JSON inside <script> must not be able to close the tag.
const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\u003c')}</script>`;

export function canonicalUrl(page: SeoPage): string {
  return `${SITE_URL}${page.slug}/`;
}

function renderHead(page: SeoPage): string {
  const url = canonicalUrl(page);
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);

  const structured: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Agent Pulse', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: GROUP_LABELS[page.group] },
        { '@type': 'ListItem', position: 3, name: page.h1, item: url },
      ],
    },
  ];
  if (page.group === 'guide') {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.h1,
      description: page.description,
      dateModified: page.updated,
      author: { '@type': 'Person', name: 'Dipen Dedania', url: 'https://github.com/Dipen-Dedania' },
      mainEntityOfPage: url,
      image: OG_IMAGE,
    });
  }
  if (page.faq?.length) {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: plainText(f.answer) },
      })),
    });
  }

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${page.group === 'guide' ? 'article' : 'website'}" />`,
    `<meta property="og:site_name" content="Agent Pulse" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    ...structured.map(jsonLd),
  ].join('\n    ');
}

export function renderPage(page: SeoPage): { head: string; body: string } {
  const body = renderToString(
    <StrictMode>
      <SeoPageView page={page} />
    </StrictMode>,
  );
  return { head: renderHead(page), body };
}
