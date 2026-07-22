import React from 'react';

// Dependency-free GitHub-flavored-Markdown renderer for backlog "report"
// artifacts. Research/execution summaries are written as plain .md files; this
// turns the common subset — headings, ordered/unordered lists, tables, fenced &
// inline code, blockquotes, emphasis, links and horizontal rules — into styled
// React nodes so the card shows a formatted preview instead of raw source.
//
// Deliberately small: no remark/rehype/react-markdown dependency (the app keeps
// its dependency surface minimal), and it never emits HTML — there is no
// dangerouslySetInnerHTML, every output is a React element and all text is
// escaped by React, so there is no injection surface from untrusted report
// content.

interface Props {
  content: string;
  className?: string;
  /** Local image resolution: filename → data URL. Markdown image refs and bare
   * filename mentions that hit this map render inline; anything else stays
   * text — the renderer never fetches remote images, so an untrusted report
   * can't trigger network requests. Used for QA-card screenshot previews. */
  images?: Record<string, string>;
}

// Opens links in the user's default browser rather than navigating the
// renderer window (which would blow away the SPA). Mirrors the app's existing
// shell-based "open" IPC pattern (see ArtifactViewer's open-path usage).
function openExternal(url: string): void {
  void window.electron.invoke('open-external', url);
}

// ---- Inline formatting -------------------------------------------------
// Earliest-match scan over: `code`, ![alt](src) images, **bold**, __bold__,
// *italic*, _italic_, [text](url) links, bare http(s) URLs, and bare image
// filenames (resolved against the `images` map). Non-greedy so adjacent
// tokens on one line don't get swallowed into a single match.
const INLINE_RE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)|([A-Za-z0-9][\w.-]*\.(?:png|jpe?g|webp)\b)/;

/** Resolve an image src to a data URL by bare filename (paths are stripped —
 * the agent may write `screens/foo.png` while the map is keyed by `foo.png`). */
function resolveImage(src: string, images?: Record<string, string>): { name: string; dataUrl: string | null } {
  const name = src.split(/[\\/]/).pop() ?? src;
  return { name, dataUrl: images?.[name] ?? null };
}

function renderInline(text: string, keyPrefix: string, images?: Record<string, string>): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith('`')) {
      // Agents often write screenshot references as inline code
      // (`qa-screens/foo.png`) rather than image syntax — when the code span
      // is exactly an image path that resolves in the map, show the image.
      const inner = tok.slice(1, -1).trim();
      const codeImage = /\.(?:png|jpe?g|webp)$/i.test(inner) ? resolveImage(inner, images) : null;
      if (codeImage?.dataUrl) {
        out.push(
          <img
            key={key}
            src={codeImage.dataUrl}
            alt={codeImage.name}
            className='block my-2 max-w-full max-h-80 rounded-lg border border-edge/50'
          />,
        );
      } else {
        out.push(
          <code
            key={key}
            className='px-1 py-0.5 rounded bg-glass/80 text-ok font-mono text-[0.85em]'
          >
            {tok.slice(1, -1)}
          </code>,
        );
      }
    } else if (tok.startsWith('![')) {
      // ![alt](src) — inline image. Only local screenshots from the images map
      // render; an unresolved src degrades to its alt text + filename.
      const im = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(tok)!;
      const { name, dataUrl } = resolveImage(im[2], images);
      if (dataUrl) {
        out.push(
          <img
            key={key}
            src={dataUrl}
            alt={im[1] || name}
            className='block my-2 max-w-full max-h-80 rounded-lg border border-edge/50'
          />,
        );
      } else {
        out.push(
          <span key={key} className='text-faint'>
            {im[1] ? `${im[1]} ` : ''}
            <code className='px-1 py-0.5 rounded bg-glass/80 font-mono text-[0.85em]'>{name}</code>
          </span>,
        );
      }
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(
        <strong key={key} className='font-semibold text-strong'>
          {renderInline(tok.slice(2, -2), key, images)}
        </strong>,
      );
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      out.push(
        <em key={key} className='italic'>
          {renderInline(tok.slice(1, -1), key, images)}
        </em>,
      );
    } else if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = lm[2];
      out.push(
        <a
          key={key}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            openExternal(href);
          }}
          className='text-info hover:text-info/80 underline underline-offset-2 cursor-pointer'
        >
          {renderInline(lm[1], key, images)}
        </a>,
      );
    } else if (tok.startsWith('http://') || tok.startsWith('https://')) {
      out.push(
        <a
          key={key}
          href={tok}
          onClick={(e) => {
            e.preventDefault();
            openExternal(tok);
          }}
          className='text-info hover:text-info/80 underline underline-offset-2 cursor-pointer break-all'
        >
          {tok}
        </a>,
      );
    } else {
      // Bare image filename (e.g. "see theme-toggle.png") — render inline when
      // the report's screenshot map has it, otherwise leave the text as-is.
      const { dataUrl } = resolveImage(tok, images);
      if (dataUrl) {
        out.push(
          <img
            key={key}
            src={dataUrl}
            alt={tok}
            className='block my-2 max-w-full max-h-80 rounded-lg border border-edge/50'
          />,
        );
      } else {
        out.push(tok);
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

// ---- Block-level parsing -----------------------------------------------
const HEADING_CLASS: Record<number, string> = {
  1: 'text-lg font-bold text-strong mt-4 mb-2 first:mt-0',
  2: 'text-base font-bold text-strong mt-4 mb-2 first:mt-0',
  3: 'text-sm font-semibold text-primary mt-3 mb-1.5 first:mt-0',
  4: 'text-sm font-semibold text-primary mt-3 mb-1.5 first:mt-0',
  5: 'text-xs font-semibold uppercase tracking-wide text-body mt-3 mb-1 first:mt-0',
  6: 'text-xs font-semibold uppercase tracking-wide text-muted mt-3 mb-1 first:mt-0',
};

// A GFM table separator row, e.g. `| --- | :--: |` (with ≥1 column).
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const RE_FENCE = /^\s*```/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s*>\s?/;
const RE_UL = /^\s*[-*+]\s+/;
const RE_OL = /^\s*\d+[.)]\s+/;

function renderBlocks(src: string, images?: Record<string, string>): React.ReactNode[] {
  const inline = (t: string, kp: string) => renderInline(t, kp, images);
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let key = 0;
  const k = () => `b-${key++}`;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip (paragraph separator).
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Fenced code block ```lang … ```
    if (RE_FENCE.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if any)
      blocks.push(
        <pre
          key={k()}
          className='my-2 p-3 rounded-lg bg-glass/60 border border-edge/50 overflow-x-auto apple-scroll'
        >
          <code className='font-mono text-xs text-primary leading-relaxed whitespace-pre'>
            {buf.join('\n')}
          </code>
        </pre>,
      );
      continue;
    }

    // Heading # … ######
    const h = RE_HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        React.createElement(
          `h${level}`,
          { key: k(), className: HEADING_CLASS[level] },
          inline(h[2].trim(), k()),
        ),
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (RE_HR.test(line)) {
      blocks.push(<hr key={k()} className='my-3 border-edge/60' />);
      i++;
      continue;
    }

    // Table (header row immediately followed by a separator row)
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={k()} className='my-2 overflow-x-auto apple-scroll'>
          <table className='w-full text-xs border-collapse'>
            <thead>
              <tr>
                {header.map((c, ci) => (
                  <th
                    key={ci}
                    className='border border-edge/60 px-2 py-1 text-left font-semibold text-primary bg-glass/40'
                  >
                    {inline(c, `th-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td
                      key={ci}
                      className='border border-edge/60 px-2 py-1 text-body align-top'
                    >
                      {inline(r[ci] ?? '', `td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote (consecutive `>` lines)
    if (RE_QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(RE_QUOTE, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={k()}
          className='my-2 pl-3 border-l-2 border-edge-strong text-muted italic'
        >
          {inline(buf.join(' '), k())}
        </blockquote>,
      );
      continue;
    }

    // Unordered list (consecutive -/*/+ items)
    if (RE_UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        items.push(lines[i].replace(RE_UL, ''));
        i++;
      }
      blocks.push(
        <ul
          key={k()}
          className='my-2 pl-5 list-disc marker:text-faint flex flex-col gap-1'
        >
          {items.map((it, ii) => (
            <li key={ii} className='text-primary leading-relaxed'>
              {inline(it, `li-${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list (consecutive `1.` / `2)` items)
    if (RE_OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        items.push(lines[i].replace(RE_OL, ''));
        i++;
      }
      blocks.push(
        <ol
          key={k()}
          className='my-2 pl-5 list-decimal marker:text-faint flex flex-col gap-1'
        >
          {items.map((it, ii) => (
            <li key={ii} className='text-primary leading-relaxed'>
              {inline(it, `oli-${ii}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — gather consecutive plain lines until a blank line or the
    // start of another block.
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !RE_HEADING.test(lines[i]) &&
      !RE_HR.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) &&
      !RE_UL.test(lines[i]) &&
      !RE_OL.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className='my-2 text-primary leading-relaxed'>
        {inline(buf.join('\n'), k())}
      </p>,
    );
  }

  return blocks;
}

export const Markdown: React.FC<Props> = ({ content, className, images }) => {
  const blocks = React.useMemo(() => renderBlocks(content, images), [content, images]);
  return <div className={`ap-markdown break-words ${className ?? ''}`}>{blocks}</div>;
};
