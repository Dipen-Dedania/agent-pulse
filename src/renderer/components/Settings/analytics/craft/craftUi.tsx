import React from 'react';
import { Badge, BadgeTone } from '../../../Shared';
import { formatShortDuration } from '../shared';
import { Band, Direction, SignalFormat, Trend } from './craftModel';

const BAND_LABEL: Record<Band, string> = { strong: 'Strong', ok: 'OK', 'needs-work': 'Needs work' };
const BAND_TONE: Record<Band, BadgeTone> = { strong: 'ok', ok: 'info', 'needs-work': 'warn' };

export const BandBadge: React.FC<{ band: Band | null; enoughData: boolean; judged: boolean }> = ({ band, enoughData, judged }) => {
  if (!judged) return <Badge tone='neutral' variant='tag' size='sm'>Not rated</Badge>;
  if (!enoughData || !band) return <Badge tone='neutral' variant='tag' size='sm'>Not enough data</Badge>;
  return <Badge tone={BAND_TONE[band]} variant='tag' size='sm'>{BAND_LABEL[band]}</Badge>;
};

const TREND_TEXT: Record<Trend, { glyph: string; word: string; cls: string }> = {
  better: { glyph: '↑', word: 'better', cls: 'text-ok' },
  worse: { glyph: '↓', word: 'worse', cls: 'text-warn' },
  steady: { glyph: '→', word: 'steady', cls: 'text-faint' },
};

/**
 * A skill's overall trend as a word: "↑ Improving", "↓ Slipping". Steady shows
 * nothing, so an unchanged skill carries no arrow at all.
 */
export const TrendLabel: React.FC<{ trend: Trend | null }> = ({ trend }) => {
  if (!trend || trend === 'steady') return null;
  const t = TREND_TEXT[trend];
  return (
    <span className={`text-[11px] font-medium ${t.cls}`} aria-label={`${t.word} than the previous period`}>
      {trend === 'better' ? '↑ Improving' : '↓ Slipping'}
    </span>
  );
};

/**
 * Beside one number: the arrow shows which way the number MOVED, the colour
 * whether that was good. So more auto-compactions reads "↑" in amber, fewer
 * reads "↓" in green. Flat shows nothing.
 */
export const SignalDelta: React.FC<{ trend: Trend | null; direction: Direction | null }> = ({ trend, direction }) => {
  if (!trend || !direction || direction === 'flat') return null;
  const t = TREND_TEXT[trend];
  return (
    <span
      className={`text-xs font-medium ${t.cls}`}
      aria-label={`${direction === 'up' ? 'up' : 'down'} since the previous period, ${t.word}`}
    >
      {direction === 'up' ? '↑' : '↓'}
    </span>
  );
};

/** Lightbulb glyph that marks a tip, so tips never share the arrow with trends. */
export const TipIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox='0 0 16 16' width={14} height={14} aria-hidden className={className} fill='none' stroke='currentColor' strokeWidth={1.4} strokeLinecap='round' strokeLinejoin='round'>
    <path d='M6 12.5h4M6.5 14.5h3' />
    <path d='M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.7.6 1.2v.1h4v-.1c0-.5.2-.9.6-1.2A4.5 4.5 0 0 0 8 1.5Z' />
  </svg>
);

export function formatSignal(value: number | null, format: SignalFormat): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'pct': return `${Math.round(value)}%`;
    case 'ratio': return `${Math.round(value * 100)}%`;
    case 'words': return `${Math.round(value)} words`;
    case 'perSession': return value.toFixed(2);
    case 'prompts': return value.toFixed(1);
    case 'duration': return formatShortDuration(value);
  }
}
