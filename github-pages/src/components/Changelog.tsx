/**
 * Changelog — "What's new"
 * Renders the latest few GitHub releases as a <details> accordion (mirrors
 * FAQ.tsx for free keyboard + screen-reader support). Release bodies are
 * markdown; we render them with a tiny dependency-free formatter into real
 * React nodes (never dangerouslySetInnerHTML on remote text). Always links out
 * to the full changelog on GitHub, and degrades gracefully when the API is
 * unavailable.
 */
import type { ReactNode } from 'react';
import { RELEASES_URL, useReleases, type ReleaseNote } from '../hooks/useLatestRelease';

// ---------------------------------------------------------------------------
// Minimal markdown → React (inline: **bold**, `code`, [text](url); block:
// #/##/### headings and -/* bullet lists). Anything else renders as a paragraph.
// ---------------------------------------------------------------------------

function renderInline(text: string): ReactNode[] {
  // Split on bold / code / links while keeping the delimiters.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.filter(Boolean).map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-midnight-navy">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('`') && tok.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-fog px-1.5 py-0.5 font-mono text-[12px] text-midnight-navy"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-signal-blue underline underline-offset-2"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}

function renderBody(body: string): ReactNode {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    const items = [...list];
    list = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 flex list-disc flex-col gap-1 pl-5">
        {items.map((li, i) => (
          <li key={i} className="text-body-sm text-slate-blue">
            {renderInline(li)}
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    if (line.trim() === '') continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={`h-${blocks.length}`} className="mt-3 text-body-sm font-semibold text-midnight-navy">
          {renderInline(heading[2])}
        </p>,
      );
      continue;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-2 text-body-sm text-slate-blue">
        {renderInline(line)}
      </p>,
    );
  }
  flushList();
  return blocks;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function ReleaseItem({ release, open }: { release: ReleaseNote; open: boolean }) {
  return (
    <details open={open} className="group rounded-cards border border-mist-border bg-paper shadow-sm">
      <summary
        className={[
          'flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5',
          'text-body-sm font-semibold text-midnight-navy',
          '[&::-webkit-details-marker]:hidden',
        ].join(' ')}
      >
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>{release.name}</span>
          <span className="text-caption font-normal text-steel-blue">
            {formatDate(release.publishedAt)}
          </span>
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
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

      <div className="px-6 pb-6">
        {release.body.trim() ? (
          renderBody(release.body)
        ) : (
          <p className="my-2 text-body-sm text-slate-blue">
            See the release notes on GitHub.
          </p>
        )}
        <a
          href={release.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-caption font-medium text-signal-blue underline underline-offset-2"
        >
          View {release.version} on GitHub ↗
        </a>
      </div>
    </details>
  );
}

export default function Changelog() {
  const { releases, loaded } = useReleases();

  return (
    <section id="changelog" className="py-20 bg-mist border-y border-mist-border">
      <div className="mx-auto max-w-[720px] px-6">
        <h2 className="mb-4 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          What&rsquo;s new
        </h2>
        <p className="mb-12 text-center text-body-sm text-slate-blue">
          The latest releases, straight from GitHub.
        </p>

        {loaded && releases.length === 0 ? (
          // API failed or no releases — never dead-end.
          <p className="text-center text-body-sm text-slate-blue">
            Browse every release and its notes on the{' '}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-midnight-navy underline underline-offset-2 hover:text-signal-blue"
            >
              Releases page ↗
            </a>
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Placeholder skeletons keep layout stable before data arrives. */}
            {(loaded ? releases : ([null, null, null] as (ReleaseNote | null)[])).map((release, i) =>
              release ? (
                <ReleaseItem key={release.version} release={release} open={i === 0} />
              ) : (
                <div
                  key={`skeleton-${i}`}
                  className="h-[68px] animate-pulse rounded-cards border border-mist-border bg-paper shadow-sm"
                  aria-hidden
                />
              ),
            )}
          </div>
        )}

        <p className="mt-8 text-center text-body-sm text-slate-blue">
          Full changelog on the{' '}
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-midnight-navy underline underline-offset-2 hover:text-signal-blue"
          >
            Releases page ↗
          </a>
        </p>
      </div>
    </section>
  );
}
