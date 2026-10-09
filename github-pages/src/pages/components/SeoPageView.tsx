/**
 * Layout for the standalone SEO pages (use cases, comparisons, guides).
 * Pre-rendered to static HTML by scripts/prerender.mjs and hydrated by
 * ../entry-client.tsx, so everything here must render the same on the server
 * and in the browser — no window/navigator reads outside effects.
 */
import NavBar from '../../components/NavBar';
import Footer from '../../components/Footer';
import { CellValue } from '../../components/Comparison';
import { RELEASES_URL } from '../../hooks/useLatestRelease';
import { GROUP_LABELS, HOME_URL, homeAnchor, pageLinks, pageUrl } from '../links';
import type { PageSection, SeoPage } from '../types';
import InlineText from './InlineText';

function formatDate(iso: string): string {
  // Fixed locale + UTC so server and client produce the same string.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function Section({ section }: { section: PageSection }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-subheading font-bold text-midnight-navy">{section.heading}</h2>
      <div className="flex flex-col gap-4 text-body-sm text-slate-blue">
        {section.paragraphs?.map((p) => (
          <p key={p}>
            <InlineText text={p} />
          </p>
        ))}
        {section.bullets && (
          <ul className="list-disc space-y-2 pl-5 marker:text-steel-blue">
            {section.bullets.map((b) => (
              <li key={b}>
                <InlineText text={b} />
              </li>
            ))}
          </ul>
        )}
        {section.steps && (
          <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-midnight-navy">
            {section.steps.map((s) => (
              <li key={s}>
                <InlineText text={s} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function CtaButtons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={homeAnchor('download')}
        className="inline-flex items-center bg-signal-blue px-5 py-3 text-body-sm font-semibold text-paper no-underline transition-colors duration-150 hover:bg-[#0055d4]"
        style={{ borderRadius: 'var(--radius-buttons)', boxShadow: 'var(--shadow-sm-3)' }}
      >
        Download free
      </a>
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-4 py-3 text-body-sm font-medium text-midnight-navy no-underline transition-colors duration-150 hover:text-signal-blue"
      >
        All releases on GitHub&nbsp;↗
      </a>
    </div>
  );
}

export default function SeoPageView({ page }: { page: SeoPage }) {
  const related = pageLinks.filter((l) => l.slug !== page.slug);

  return (
    <>
      <NavBar />
      <main>
        <article className="mx-auto max-w-[760px] px-6 pb-16 pt-12">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-6 text-caption text-steel-blue">
            <a href={HOME_URL} className="hover:text-signal-blue">
              Agent Pulse
            </a>
            <span className="mx-2" aria-hidden>
              ›
            </span>
            <span>{GROUP_LABELS[page.group]}</span>
          </nav>

          <span
            className="mb-4 inline-flex items-center rounded-badges bg-fog px-3 py-1 font-semibold text-midnight-navy"
            style={{ fontSize: 12, lineHeight: 1.5, letterSpacing: '0.02em' }}
          >
            {page.eyebrow}
          </span>
          <h1
            className="mb-5 font-bold text-midnight-navy"
            style={{ fontSize: 'clamp(32px, 5vw, 50px)', lineHeight: 1.15 }}
          >
            {page.h1}
          </h1>
          <p className="mb-6 text-body text-slate-blue">
            <InlineText text={page.lede} />
          </p>
          <CtaButtons />
          <p className="mt-4 text-micro text-steel-blue">
            Free &amp; open source · Windows, macOS, Linux · Updated{' '}
            <time dateTime={page.updated}>{formatDate(page.updated)}</time>
          </p>

          {page.screenshot && (
            <figure className="mt-10">
              <img
                src={`${HOME_URL}screenshots/${page.screenshot.file}`}
                alt={page.screenshot.alt}
                className="w-full rounded-cards border border-mist-border shadow-sm"
                loading="lazy"
              />
            </figure>
          )}

          {page.sections.map((s) => (
            <Section key={s.heading} section={s} />
          ))}

          {page.comparison && (
            <section className="mt-12">
              <h2 className="mb-4 text-subheading font-bold text-midnight-navy">
                Side by side
              </h2>
              <div className="overflow-x-auto rounded-cards border border-mist-border shadow-sm">
                <table className="w-full min-w-[520px] border-collapse bg-paper text-left">
                  <thead>
                    <tr className="border-b border-mist-border">
                      <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wide text-steel-blue">
                        Capability
                      </th>
                      <th className="bg-fog/60 px-4 py-3 text-body-sm font-bold text-midnight-navy">
                        Agent Pulse
                      </th>
                      <th className="px-4 py-3 text-body-sm font-semibold text-slate-blue">
                        {page.comparison.competitor}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.comparison.rows.map((row) => (
                      <tr key={row.feature} className="border-b border-mist-border last:border-0">
                        <th scope="row" className="px-4 py-3 text-body-sm font-medium text-midnight-navy">
                          {row.feature}
                        </th>
                        <td className="bg-fog/60 px-4 py-3">
                          <CellValue value={row.agentPulse} emphasis />
                        </td>
                        <td className="px-4 py-3">
                          <CellValue value={row.them} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-micro text-steel-blue">{page.comparison.source}</p>
            </section>
          )}

          {page.afterSections?.map((s) => (
            <Section key={s.heading} section={s} />
          ))}

          {page.faq && (
            <section className="mt-12">
              <h2 className="mb-4 text-subheading font-bold text-midnight-navy">Questions</h2>
              <div className="flex flex-col gap-3">
                {page.faq.map((item) => (
                  <details
                    key={item.question}
                    className="group rounded-cards border border-mist-border bg-paper shadow-sm"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-body-sm font-semibold text-midnight-navy [&::-webkit-details-marker]:hidden">
                      <span>{item.question}</span>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-steel-blue transition-transform duration-200 group-open:rotate-180"
                        aria-hidden
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </summary>
                    <p className="px-5 pb-5 text-body-sm text-slate-blue">
                      <InlineText text={item.answer} />
                    </p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* Closing CTA */}
          <section className="mt-14 rounded-cards border border-mist-border bg-mist px-6 py-8">
            <h2 className="mb-2 text-subheading font-bold text-midnight-navy">
              Try Agent Pulse
            </h2>
            <p className="mb-5 text-body-sm text-slate-blue">
              Free, open source and local-only. Status bubbles, usage meters and guardrails for
              Claude Code, Codex, Cursor, Copilot and more.
            </p>
            <CtaButtons />
          </section>

          {related.length > 0 && (
            <nav aria-label="Related pages" className="mt-12">
              <h2 className="mb-3 text-caption font-semibold uppercase tracking-widest text-steel-blue">
                Related
              </h2>
              <ul className="flex flex-col gap-2">
                {related.map((l) => (
                  <li key={l.slug}>
                    <a
                      href={pageUrl(l.slug)}
                      className="text-body-sm font-medium text-signal-blue hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </article>
      </main>
      <Footer />
    </>
  );
}
