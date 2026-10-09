import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '../theme.css';
import SeoPageView from './components/SeoPageView';
import { findPage } from './index';

// Built pages: scripts/prerender.mjs writes the slug onto #root and the
// markup inside it, so we hydrate. In `npm run dev` the template is served
// raw — open /agent-pulse/pages.html?slug=<slug> to render a page client-side.
const root = document.getElementById('root')!;
const prerendered = root.childElementCount > 0;
const slug = prerendered
  ? root.dataset.slug
  : new URLSearchParams(window.location.search).get('slug');
const page = findPage(slug ?? '');

if (page) {
  const app = (
    <StrictMode>
      <SeoPageView page={page} />
    </StrictMode>
  );
  if (prerendered) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
