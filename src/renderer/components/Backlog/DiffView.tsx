import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseDiff, Diff, Hunk, tokenize, markEdits } from 'react-diff-view';
// Use refractor's bare core + register only the languages we map below, in
// dependency order (markup/clike are bases for jsx/js). The full `refractor`
// build bundles ~270 grammars we'd never use.
import refractor from 'refractor/core';
import markup from 'refractor/lang/markup';
import clike from 'refractor/lang/clike';
import javascript from 'refractor/lang/javascript';
import jsx from 'refractor/lang/jsx';
import typescript from 'refractor/lang/typescript';
import tsx from 'refractor/lang/tsx';
import json from 'refractor/lang/json';
import css from 'refractor/lang/css';
import markdown from 'refractor/lang/markdown';
import bash from 'refractor/lang/bash';
import python from 'refractor/lang/python';
import yaml from 'refractor/lang/yaml';
import 'react-diff-view/style/index.css';
import { logger } from '../../../common/logger';

for (const lang of [markup, clike, javascript, jsx, typescript, tsx, json, css, markdown, bash, python, yaml]) {
  refractor.register(lang);
}

// GitKraken-style diff review for backlog execution cards. Input is the raw
// `git diff --cached --binary` patch captured in worktree.ts; we parse it into
// files → hunks and render a file rail + syntax-highlighted, side-by-side (or
// unified) hunks. Colors are re-themed to the app's glass palette via the
// `.ap-diff` scope in index.css (react-diff-view ships light-mode defaults).

type ViewType = 'split' | 'unified';
const VIEW_KEY = 'ap-diff-viewtype';
// Below this pane width a two-column split is unreadable — fall back to unified.
const SPLIT_MIN_WIDTH = 860;

interface Props {
  patch: string;
  // Set when the artifact file couldn't be read and only the ~500-char preview
  // is available (see backlog:read-artifact). The parsed diff is then partial.
  truncated?: boolean;
}

interface ParsedFile {
  type: 'add' | 'delete' | 'modify' | 'rename' | 'copy';
  oldPath: string;
  newPath: string;
  hunks: any[];
  isBinary?: boolean;
}

// Extension → refractor language id (all present in the full refractor build).
// Unknown types render without highlighting rather than throwing.
function languageForPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return 'jsx';
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'json': return 'json';
    case 'css': case 'scss': case 'less': return 'css';
    case 'md': case 'markdown': return 'markdown';
    case 'html': case 'htm': case 'xml': case 'svg': return 'markup';
    case 'sh': case 'bash': case 'zsh': return 'bash';
    case 'py': return 'python';
    case 'yml': case 'yaml': return 'yaml';
    default: return null;
  }
}

function displayPath(file: ParsedFile): string {
  const p = file.type === 'delete' ? file.oldPath : file.newPath;
  return p === '/dev/null' ? (file.oldPath || file.newPath) : p;
}

function fileStats(file: ParsedFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of file.hunks ?? []) {
    for (const c of h.changes ?? []) {
      if (c.type === 'insert') additions++;
      else if (c.type === 'delete') deletions++;
    }
  }
  return { additions, deletions };
}

const STATUS: Record<ParsedFile['type'], { dot: string; label: string }> = {
  add: { dot: 'bg-emerald-400', label: 'Added' },
  delete: { dot: 'bg-red-400', label: 'Deleted' },
  modify: { dot: 'bg-amber-400', label: 'Modified' },
  rename: { dot: 'bg-sky-400', label: 'Renamed' },
  copy: { dot: 'bg-sky-400', label: 'Copied' },
};

/** Syntax-highlight one file's hunks; falls back to plain text on any failure. */
function tokensFor(file: ParsedFile): any | undefined {
  const language = languageForPath(displayPath(file));
  if (!language || !file.hunks?.length) return undefined;
  try {
    return tokenize(file.hunks, {
      highlight: true,
      refractor,
      language,
      enhancers: [markEdits(file.hunks, { type: 'block' })],
    });
  } catch (e) {
    logger.warn('[DiffView] tokenize failed for', displayPath(file), e);
    return undefined;
  }
}

export const DiffView: React.FC<Props> = ({ patch, truncated }) => {
  const [viewType, setViewType] = useState<ViewType>(() => {
    return (localStorage.getItem(VIEW_KEY) as ViewType) || 'split';
  });
  const [wide, setWide] = useState(true);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const fileRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { files, parseError } = useMemo(() => {
    try {
      return { files: parseDiff(patch || '') as ParsedFile[], parseError: false };
    } catch (e) {
      logger.error('[DiffView] parseDiff failed', e);
      return { files: [] as ParsedFile[], parseError: true };
    }
  }, [patch]);

  const tokensByFile = useMemo(() => files.map((f) => tokensFor(f)), [files]);

  const totals = useMemo(() => {
    return files.reduce(
      (acc, f) => {
        const s = fileStats(f);
        acc.additions += s.additions;
        acc.deletions += s.deletions;
        return acc;
      },
      { additions: 0, deletions: 0 },
    );
  }, [files]);

  // Track pane width so a narrow window auto-falls back to unified.
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWide(entry.contentRect.width >= SPLIT_MIN_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setView = (v: ViewType) => {
    setViewType(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

  const effectiveView: ViewType = viewType === 'split' && wide ? 'split' : 'unified';

  const scrollToFile = (i: number) => {
    fileRefs.current[i]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  if (parseError) {
    // Malformed/truncated patch we can't structure — degrade to the raw text.
    return (
      <>
        {truncated && <TruncatedBanner />}
        <pre className='text-xs text-primary leading-relaxed font-mono max-h-96 overflow-auto apple-scroll whitespace-pre'>
          {patch || 'No diff.'}
        </pre>
      </>
    );
  }

  if (files.length === 0) {
    return <p className='text-sm text-muted'>No changes in this diff.</p>;
  }

  return (
    <div className='flex flex-col gap-2'>
      {/* Summary + view toggle */}
      <div className='flex items-center gap-3 text-xs'>
        <span className='text-muted'>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className='text-ok font-medium'>+{totals.additions}</span>
        <span className='text-danger font-medium'>−{totals.deletions}</span>
        <div className='flex-1' />
        <div className='flex rounded-lg overflow-hidden border border-edge/70'>
          <button
            onClick={() => setView('split')}
            disabled={!wide}
            title={wide ? 'Side-by-side' : 'Window too narrow for side-by-side'}
            className={`px-2.5 py-1 font-medium transition-colors ${
              effectiveView === 'split'
                ? 'bg-control text-strong'
                : 'bg-inset/60 text-muted hover:text-primary'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Split
          </button>
          <button
            onClick={() => setView('unified')}
            className={`px-2.5 py-1 font-medium transition-colors ${
              effectiveView === 'unified'
                ? 'bg-control text-strong'
                : 'bg-inset/60 text-muted hover:text-primary'
            }`}
          >
            Unified
          </button>
        </div>
      </div>

      {truncated && <TruncatedBanner />}

      <div className='flex gap-3 h-[68vh]'>
        {/* File rail */}
        <div className='w-56 shrink-0 overflow-y-auto overflow-x-hidden apple-scroll flex flex-col gap-0.5 pr-1'>
          {files.map((file, i) => {
            const s = fileStats(file);
            const status = STATUS[file.type] ?? STATUS.modify;
            const path = displayPath(file);
            const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
            const base = path.slice(path.lastIndexOf('/') + 1);
            return (
              <button
                key={`${path}-${i}`}
                onClick={() => scrollToFile(i)}
                title={file.type === 'rename' ? `${file.oldPath} → ${file.newPath}` : path}
                className='group flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-control/40 transition-colors'
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} aria-label={status.label} />
                {/* Dir truncates first (shrinkable); filename stays visible, capped at rail width. */}
                <span className='flex-1 min-w-0 flex text-xs leading-tight'>
                  {dir && <span className='truncate text-faint'>{dir}</span>}
                  <span className='truncate shrink-0 max-w-full text-primary font-medium'>{base}</span>
                </span>
                <span className='shrink-0 text-[10px] font-mono tabular-nums'>
                  <span className='text-ok'>+{s.additions}</span>{' '}
                  <span className='text-danger'>−{s.deletions}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Hunk pane */}
        <div ref={paneRef} className='flex-1 min-w-0 overflow-auto apple-scroll ap-diff'>
          {files.map((file, i) => {
            const status = STATUS[file.type] ?? STATUS.modify;
            const path = displayPath(file);
            return (
              <div
                key={`${path}-${i}`}
                ref={(el) => { fileRefs.current[i] = el; }}
                className='mb-3 rounded-lg border border-edge/50 overflow-hidden bg-inset/30'
              >
                <div className='sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-glass/90 backdrop-blur border-b border-edge/50'>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
                  <span className='text-xs font-mono text-primary truncate flex-1'>
                    {file.type === 'rename' ? `${file.oldPath} → ${file.newPath}` : path}
                  </span>
                  <span className='shrink-0 text-[10px] uppercase tracking-wider text-faint'>{status.label}</span>
                </div>
                {file.isBinary || !file.hunks?.length ? (
                  <p className='px-3 py-2 text-xs text-faint italic'>
                    {file.isBinary ? 'Binary file — not shown.' : 'No textual changes.'}
                  </p>
                ) : (
                  <Diff
                    viewType={effectiveView}
                    diffType={file.type}
                    hunks={file.hunks}
                    tokens={tokensByFile[i]}
                  >
                    {(hunks: any[]) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                  </Diff>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const TruncatedBanner: React.FC = () => (
  <div className='rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200'>
    This diff is too large to load in full — showing a partial preview. Use <span className='font-semibold'>Open file</span> for the complete patch.
  </div>
);
