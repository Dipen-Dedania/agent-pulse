import React, { useId, useState } from 'react';
import { motion } from 'framer-motion';
import { UsageState } from '../../../../common/types';
import { GlassToggle, Button, Badge, type BadgeTone } from '../../Shared';
import { smooth } from '../../../motion';

// ── Shared usage-panel primitives ───────────────────────────────────────────
// Every provider's usage section (Claude, Codex, Cursor, Copilot, Antigravity)
// shares the same shell: a titled glass panel with a live state pill + master
// toggle, an optional warning banner, notification threshold rows, a poll
// interval, and a "Refresh now" button. These were copy-pasted across five
// files (and had already drifted — different margins, two input shells, hover
// on one only). They now live here so a fix lands everywhere at once.

/** One notification setting: whether it fires and at what % threshold. */
export interface UsageNotificationUI {
  enabled: boolean;
  threshold: number;
}

/** Default human labels per state. Providers may override individual entries
 *  (e.g. Antigravity says "IDE unavailable" instead of "Endpoint unavailable"). */
export const DEFAULT_STATE_LABEL: Record<UsageState, string> = {
  ok: 'Live',
  unknown: 'Waiting for first poll…',
  unauthenticated: 'Sign in required',
  unavailable: 'Endpoint unavailable',
  'rate-limited': 'Rate-limited',
  'network-error': 'Network error',
};

// Each state maps to a shared Badge tone (which carries both the pill colour and
// the colour-blind-safe status dot). Kept as a map so the pill stays pixel-stable
// against the hand-rolled version it replaced.
const STATE_TONE: Record<UsageState, BadgeTone> = {
  ok: 'ok',
  unknown: 'neutral',
  unauthenticated: 'warn',
  unavailable: 'warn',
  'rate-limited': 'warn',
  'network-error': 'danger',
};

export function formatRelativeReset(targetMs: number | undefined): string {
  if (!targetMs) return '—';
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const remMins = mins % 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

/** Graded fill for a "% remaining" bar — green with headroom, amber getting
 *  low, red near-empty. Shared so every provider's bar reads the same. */
export function quotaFillClass(remaining: number): string {
  if (remaining > 50) return 'bg-emerald-400/80';
  if (remaining > 20) return 'bg-amber-400/85';
  return 'bg-red-400/85';
}

// ── State pill ───────────────────────────────────────────────────────────────
export const StatePill: React.FC<{
  state: UsageState;
  labels?: Partial<Record<UsageState, string>>;
}> = ({ state, labels }) => {
  const label = labels?.[state] ?? DEFAULT_STATE_LABEL[state];
  return (
    <Badge tone={STATE_TONE[state]} variant='pill' dot uppercase size='xs' role='status' aria-live='polite'>
      {label}
    </Badge>
  );
};

// ── Warning / status banner ───────────────────────────────────────────────────
export const UsageMessage: React.FC<{ message?: string; state: UsageState }> = ({
  message,
  state,
}) =>
  message && state !== 'ok' ? (
    <p className='mt-4 text-sm text-warn/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2'>
      {message}
    </p>
  ) : null;

// ── Quota card ────────────────────────────────────────────────────────────────
// The one snapshot card used by every provider: an uppercase label, a big
// "% available" figure, a reset/detail line, and a graded progress bar. Pass
// `remaining={null}` before the first poll lands to show a placeholder with no
// bar; `unlimited` swaps the figure for ∞ and hides the bar.
export const QuotaBar: React.FC<{
  label: React.ReactNode;
  remaining: number | null;
  unlimited?: boolean;
  sub?: React.ReactNode;
}> = ({ label, remaining, unlimited, sub }) => {
  const hasValue = remaining !== null && Number.isFinite(remaining);
  const pct = hasValue ? Math.max(0, Math.min(100, remaining as number)) : 0;
  const showBar = hasValue && !unlimited;
  return (
    <div className='glass-secondary p-4'>
      <p className='text-xs uppercase tracking-widest text-faint font-semibold'>{label}</p>
      <p className='text-2xl font-bold text-strong mt-1'>
        {unlimited ? '∞' : hasValue ? `${Math.round(remaining as number)}%` : '—'}
        <span className='text-xs font-normal text-muted ml-1'>available</span>
      </p>
      {sub != null && <p className='text-xs text-muted mt-1'>{sub}</p>}
      {/* Reserve the bar's height even when hidden so the card doesn't reflow
          when the first snapshot arrives over IPC. */}
      <div className='mt-2 h-1.5 rounded-full bg-control/40 overflow-hidden'>
        {showBar && (
          <div
            className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${quotaFillClass(pct)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
};

// ── Notification threshold row (toggle + themed slider) ───────────────────────
const NotifyRow: React.FC<{
  title: string;
  hint: string;
  value: UsageNotificationUI;
  comparator: 'lte' | 'gte'; // labelling only, not value semantics
  onChange: (next: UsageNotificationUI) => void;
}> = ({ title, hint, value, comparator, onChange }) => {
  const op = comparator === 'lte' ? '≤' : '≥';
  const sliderId = useId();
  return (
    <div className='glass-secondary p-4'>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-strong text-sm leading-tight'>{title}</p>
          <p className='text-xs text-muted mt-1'>{hint}</p>
        </div>
        <GlassToggle
          checked={value.enabled}
          onChange={() => onChange({ ...value, enabled: !value.enabled })}
          size='md'
          label={`Toggle ${title}`}
        />
      </div>

      <div className={`flex items-center gap-3 mt-3 ${value.enabled ? '' : 'opacity-50'}`}>
        <label htmlFor={sliderId} className='text-xs text-faint font-mono whitespace-nowrap'>
          remaining {op}
        </label>
        <input
          id={sliderId}
          type='range'
          min={1}
          max={99}
          value={value.threshold}
          disabled={!value.enabled}
          aria-label={`${title} threshold: notify when remaining ${op} ${value.threshold}%`}
          onChange={(e) => onChange({ ...value, threshold: Number(e.target.value) })}
          className='flex-1'
        />
        <span className='text-sm text-strong font-mono w-10 text-right tabular-nums'>
          {value.threshold}%
        </span>
      </div>
    </div>
  );
};

// ── Cap-warning + nudge pair (the standard two-row notifications block) ───────
export const NotificationsGroup: React.FC<{
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
  capHint: string;
  nudgeHint: string;
  onCapChange: (next: UsageNotificationUI) => void;
  onNudgeChange: (next: UsageNotificationUI) => void;
}> = ({ capWarning, nudge, capHint, nudgeHint, onCapChange, onNudgeChange }) => (
  <div className='mt-6'>
    <p className='text-xs uppercase tracking-widest text-faint font-semibold mb-3'>Notifications</p>
    <div className='grid grid-cols-1 gap-3'>
      <NotifyRow
        title='Cap warning'
        hint={capHint}
        value={capWarning}
        comparator='lte'
        onChange={onCapChange}
      />
      <NotifyRow
        title='Use-it-or-lose-it nudge'
        hint={nudgeHint}
        value={nudge}
        comparator='gte'
        onChange={onNudgeChange}
      />
    </div>
  </div>
);

// ── Poll interval (themed number input, clamps on blur with a hint) ───────────
export const PollIntervalInput: React.FC<{
  intervalMs: number;
  minSec: number;
  fallbackSec: number;
  maxSec?: number;
  onChange: (intervalMs: number) => void;
}> = ({ intervalMs, minSec, fallbackSec, maxSec = 3600, onChange }) => {
  const [draft, setDraft] = useState<string>(String(Math.round(intervalMs / 1000)));
  const [coerced, setCoerced] = useState(false);

  // Keep the field in sync when the config changes from elsewhere.
  const currentSec = String(Math.round(intervalMs / 1000));
  React.useEffect(() => {
    setDraft(currentSec);
  }, [currentSec]);

  const commit = () => {
    const raw = Number(draft);
    const next = Math.max(minSec, Math.min(maxSec, Number.isFinite(raw) && raw > 0 ? raw : fallbackSec));
    setCoerced(next !== raw);
    setDraft(String(next));
    onChange(next * 1000);
  };

  return (
    <div className='mt-5'>
      <label className='flex flex-col gap-1.5'>
        <span className='text-xs uppercase tracking-widest text-faint font-semibold'>
          Poll interval
        </span>
        <div className='flex items-center gap-2'>
          <input
            type='number'
            min={minSec}
            max={maxSec}
            step={30}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCoerced(false);
            }}
            onBlur={commit}
            className='w-24 glass-secondary rounded-lg px-3 py-1.5 text-sm text-strong tabular-nums focus:outline-none'
          />
          <span className='text-xs text-faint'>seconds (min {minSec})</span>
        </div>
      </label>
      {coerced && (
        <p className='mt-1.5 text-xs text-warn/90'>
          Adjusted to the allowed range ({minSec}–{maxSec}s).
        </p>
      )}
    </div>
  );
};

// ── Panel shell ───────────────────────────────────────────────────────────────
export const UsageProviderPanel: React.FC<{
  title: string;
  subtitle: React.ReactNode;
  state: UsageState;
  stateLabels?: Partial<Record<UsageState, string>>;
  enabled: boolean;
  onToggleEnabled: () => void;
  toggleLabel: string;
  onRefresh: () => void;
  children: React.ReactNode;
}> = ({
  title,
  subtitle,
  state,
  stateLabels,
  enabled,
  onToggleEnabled,
  toggleLabel,
  onRefresh,
  children,
}) => (
  <motion.section
    whileHover={{ scale: 1.003 }}
    transition={smooth}
    className='glass-primary mt-6 p-6'
  >
    <div className='flex items-start gap-4'>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-3'>
          <h2 className='text-lg font-bold text-strong'>{title}</h2>
          <StatePill state={state} labels={stateLabels} />
        </div>
        <p className='text-sm text-muted mt-1'>{subtitle}</p>
      </div>

      <GlassToggle checked={enabled} onChange={onToggleEnabled} size='lg' label={toggleLabel} />
    </div>

    {children}

    {enabled && (
      <div className='mt-5 flex gap-2'>
        <Button onClick={onRefresh}>Refresh now</Button>
      </div>
    )}
  </motion.section>
);
