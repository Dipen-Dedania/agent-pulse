import React from 'react';
import {
  CODEX_STATUS_LINE_ITEMS,
  CodexStatusLineConfig,
  CodexStatusLineDetectInfo,
  CodexStatusLineItem,
} from '../../../common/types';
import { CODEX_ITEM_LABEL, CODEX_ITEM_MOCK, CODEX_ITEM_SINCE_0_160, renderCodexStatusLinePreview } from '../../../common/codex-statusline';
import { Badge, Button, IconButton, Select } from '../Shared';

// Codex draws its own footer from `[tui] status_line = [...]` in config.toml,
// so this editor is a list of built-in item ids — no segments, colours, or
// scripts like the Claude Code status line. Mirrors StatusLineSection's
// header / preview / install block so the two sub-tabs feel the same.

interface Props {
  config: CodexStatusLineConfig;
  detect: CodexStatusLineDetectInfo;
  onChange: (partial: Partial<CodexStatusLineConfig>) => void;
  onInstall: (replace?: boolean) => void;
  onRemove: () => void;
  onReset: () => void;
}

const ADD_PLACEHOLDER = '' as const;

export const CodexStatusLineSection: React.FC<Props> = ({ config, detect, onChange, onInstall, onRemove, onReset }) => {
  const items = config.items;
  const commit = (next: CodexStatusLineItem[]) => onChange({ items: next });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));
  const add = (id: string) => {
    if (!id || items.includes(id as CodexStatusLineItem)) return;
    commit([...items, id as CodexStatusLineItem]);
  };

  const remaining = CODEX_STATUS_LINE_ITEMS.filter((id) => !items.includes(id));
  const addOptions = [
    { value: ADD_PLACEHOLDER, label: 'Add an item…' },
    ...remaining.map((id) => ({
      value: id as string,
      label: CODEX_ITEM_SINCE_0_160.has(id) ? `${CODEX_ITEM_LABEL[id]} (Codex ≥ 0.160)` : CODEX_ITEM_LABEL[id],
    })),
  ];

  const preview = renderCodexStatusLinePreview(config);

  const runtimeBadge = detect.codexBin
    ? <Badge tone='info' variant='pill' size='md' weight='medium'>codex ✓</Badge>
    : <Badge tone='warn' variant='pill' size='md' weight='medium'>codex not found</Badge>;

  const stateBadge =
    detect.state === 'ours'
      ? <Badge tone='ok' variant='pill' size='md' weight='medium'>Installed</Badge>
      : detect.state === 'foreign'
        ? <Badge tone='neutral' variant='pill' size='md' weight='medium'>Another status line set</Badge>
        : <Badge tone='neutral' variant='pill' size='md' weight='medium'>Not installed</Badge>;

  return (
    <section className='mt-6 glass-primary p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-semibold text-strong leading-tight'>Status Line</p>
          <p className='text-xs text-muted mt-0.5'>
            Pick which built-in items Codex shows in its terminal footer (<span className='font-mono'>[tui] status_line</span> in config.toml).
            Codex draws it as plain text — no icons or colours, unlike Claude Code&apos;s scripted line.
          </p>
        </div>
        <div className='flex items-center gap-2 flex-wrap justify-end'>
          {runtimeBadge}
          {stateBadge}
        </div>
      </div>

      <div className='mt-5 flex flex-col gap-5'>
        {/* Preview — approximate: Codex owns the real formatting. */}
        <div className='glass-secondary px-4 py-3'>
          <p className='text-[10px] uppercase tracking-widest text-faint mb-2'>Preview</p>
          <div className='font-mono text-sm leading-relaxed overflow-x-auto whitespace-pre w-max'>
            {preview || <span className='text-ghost italic'>—</span>}
          </div>
          <p className='text-[11px] text-faint mt-2'>
            Approximate — Codex owns the real formatting and separator. Run <span className='font-mono'>/statusline</span> inside Codex to see it live.
          </p>
        </div>

        {/* Install / remove controls */}
        <div className='glass-secondary p-4 flex flex-wrap items-center gap-3'>
          {detect.state === 'ours' ? (
            <>
              <p className='text-sm text-body flex-1 min-w-0'>
                Installed. Edits below are written to config.toml as you make them.
              </p>
              <Button variant='secondary' onClick={() => onInstall(true)} className='text-primary'>Re-apply</Button>
              <Button variant='secondary' onClick={onRemove} className='text-primary'>Remove</Button>
            </>
          ) : detect.state === 'foreign' ? (
            <>
              <p className='text-sm text-warn/90 flex-1 min-w-0'>
                A different status line is already configured
                {detect.installedItems ? <> (<span className='font-mono'>{detect.installedItems.join(', ')}</span>)</> : null}.
                Replacing it backs up your <span className='font-mono'>config.toml</span> first.
              </p>
              <Button onClick={() => onInstall(true)} disabled={items.length === 0}>Back up &amp; replace</Button>
            </>
          ) : (
            <>
              <p className='text-sm text-body flex-1 min-w-0'>
                {detect.codexBin
                  ? 'Write these items into Codex’s config.toml.'
                  : 'The codex CLI was not found on PATH — the editor still writes config.toml for when it is.'}
              </p>
              <Button onClick={() => onInstall(false)} disabled={items.length === 0}>Install</Button>
            </>
          )}
          <p className='text-xs text-faint w-full'>
            Codex reads config.toml at startup — restart any running Codex session to see changes.
          </p>
        </div>

        {/* Items editor */}
        <div>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold mb-2'>Items (in order)</p>
          {items.length === 0 ? (
            <p className='text-sm text-muted'>No items. Add at least one to install.</p>
          ) : (
            <div className='flex flex-col gap-2'>
              {items.map((id, i) => (
                <div key={id} className='glass-secondary px-3 py-2 flex items-center gap-3'>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-strong leading-tight'>{CODEX_ITEM_LABEL[id]}</p>
                    <p className='text-[11px] text-faint font-mono truncate'>{id} · e.g. {CODEX_ITEM_MOCK[id]}</p>
                  </div>
                  <IconButton shape='square' size='sm' onClick={() => move(i, -1)} disabled={i === 0} aria-label='Move up'>↑</IconButton>
                  <IconButton shape='square' size='sm' onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label='Move down'>↓</IconButton>
                  <IconButton shape='square' size='sm' tone='danger' onClick={() => remove(i)} aria-label={`Remove ${CODEX_ITEM_LABEL[id]}`}>✕</IconButton>
                </div>
              ))}
            </div>
          )}
          {remaining.length > 0 && (
            <div className='mt-3'>
              <Select
                value={ADD_PLACEHOLDER}
                options={addOptions}
                onChange={add}
                className='min-w-[14rem]'
                ariaLabel='Add a status line item'
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex flex-wrap items-center gap-3'>
          <Button
            variant='secondary'
            size='sm'
            onClick={() => window.electron.invoke('open-path', detect.configPath)}
          >
            Open config.toml
          </Button>
          <Button variant='secondary' size='sm' onClick={onReset}>Reset to default</Button>
        </div>
      </div>
    </section>
  );
};
