import React, { useState, useEffect } from 'react';
import { BacklogSchedulerConfig, BacklogSchedulerStatus, BacklogSlot } from '../../../common/backlog-types';
import { WebhookTarget } from '../../../common/types';
import { formatUsd } from '../../../common/pricing';
import { WebhookRow } from './WebhookRow';

// Backlog Scheduler — sits beside the Cowork Scheduler in Usage → Claude Code.
// The Cowork slot is a fire INSTANT (opens a window); a backlog slot is a time
// RANGE during which queued board cards auto-execute. Mirrors the
// SchedulerSection row/toggle patterns. Board lives in the Backlog tab.

interface Props {
  config: BacklogSchedulerConfig;
  status: BacklogSchedulerStatus | null;
  onChange: (partial: Partial<BacklogSchedulerConfig>) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const PRESET_NIGHTS: BacklogSlot = { start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5], enabled: true };
// end === start is a full 24h window (see timing.ts), giving true all-day
// coverage — '23:59' would leave a one-minute nightly gap.
const PRESET_WEEKENDS: BacklogSlot = { start: '00:00', end: '00:00', days: [0, 6], enabled: true };

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDayClock(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${formatClock(ms)}`;
}

function formatCountdown(targetMs: number): string {
  const mins = Math.max(0, Math.round((targetMs - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** end <= start means the range wraps past midnight into the next day. */
function wrapsMidnight(slot: BacklogSlot): boolean {
  return slot.end <= slot.start;
}

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string; small?: boolean }> = ({
  on, onClick, label, small,
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    className={`relative ${small ? 'w-10 h-5' : 'w-11 h-6'} rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
      on ? 'bg-blue-500' : 'bg-control-strong'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 ${small ? 'w-4 h-4' : 'w-5 h-5'} bg-white rounded-full shadow transition-transform duration-200 ${
        on ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

const SlotRow: React.FC<{
  slot: BacklogSlot;
  onChange: (next: BacklogSlot) => void;
  onRemove: () => void;
}> = ({ slot, onChange, onRemove }) => {
  const toggleDay = (d: number) => {
    const days = slot.days.includes(d) ? slot.days.filter((x) => x !== d) : [...slot.days, d].sort();
    onChange({ ...slot, days });
  };
  return (
    <div className={`bg-glass/40 border border-edge/50 rounded-xl p-3 flex flex-wrap items-center gap-3 ${slot.enabled ? '' : 'opacity-50'}`}>
      <div className='flex items-center gap-1.5'>
        <input
          type='time'
          value={slot.start}
          onChange={(e) => onChange({ ...slot, start: e.target.value })}
          className='bg-glass/60 border border-edge/70 rounded-lg px-2 py-1 text-sm text-strong focus:outline-none focus:border-blue-500/60'
        />
        <span className='text-faint text-sm'>–</span>
        <input
          type='time'
          value={slot.end}
          onChange={(e) => onChange({ ...slot, end: e.target.value })}
          className='bg-glass/60 border border-edge/70 rounded-lg px-2 py-1 text-sm text-strong focus:outline-none focus:border-blue-500/60'
        />
        {wrapsMidnight(slot) && (
          <span className='px-1.5 py-0.5 rounded text-[10px] bg-control/60 text-body' title='Ends the next morning'>
            +1d
          </span>
        )}
      </div>
      <div className='flex gap-1'>
        {WEEKDAYS.map((label, d) => {
          const active = slot.days.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={`w-7 h-7 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                active ? 'bg-blue-500/80 text-white' : 'bg-control/50 text-muted hover:bg-control'
              }`}
              title={`${label} (window start day)`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className='flex items-center gap-2 ml-auto'>
        <Toggle small on={slot.enabled} onClick={() => onChange({ ...slot, enabled: !slot.enabled })} label='Toggle window' />
        <button
          onClick={onRemove}
          className='w-7 h-7 flex items-center justify-center rounded-md bg-control/50 hover:bg-red-500/30 text-muted hover:text-danger text-sm cursor-pointer transition-colors'
          aria-label='Remove window'
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export const BacklogSchedulerSection: React.FC<Props> = ({ config, status, onChange }) => {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // The webhook editor is driven by LOCAL state, not the config prop. onChange
  // round-trips through backlog:scheduler:update-config and reconciles the whole
  // config back into the prop; feeding an <input> straight off that made rows
  // flicker/vanish as a stale async reply clobbered a just-typed value. Local
  // state renders instantly; we only re-seed from the prop while the panel is
  // closed (external edits), so an open editor is never overwritten mid-keystroke.
  const [webhooks, setWebhooks] = useState<WebhookTarget[]>(config.webhooks ?? []);
  useEffect(() => {
    if (!notificationsOpen) setWebhooks(config.webhooks ?? []);
  }, [config.webhooks, notificationsOpen]);

  const activeWebhooks = webhooks.filter((w) => w.enabled && w.url.trim().length > 0).length;

  const commitWebhooks = (next: WebhookTarget[]) => {
    setWebhooks(next);            // instant, local — no flicker
    onChange({ webhooks: next }); // persist; the reconciled reply is ignored while open
  };
  const addWebhook = () => {
    const id = `wh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    commitWebhooks([...webhooks, { id, kind: 'discord', url: '', enabled: true }]);
  };
  const changeWebhook = (id: string, next: WebhookTarget) =>
    commitWebhooks(webhooks.map((w) => (w.id === id ? next : w)));
  const deleteWebhook = (id: string) => commitWebhooks(webhooks.filter((w) => w.id !== id));

  const updateSlot = (i: number, next: BacklogSlot) =>
    onChange({ slots: config.slots.map((s, idx) => (idx === i ? next : s)) });
  const addSlot = () =>
    onChange({ slots: [...config.slots, { start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5], enabled: true }] });
  const removeSlot = (i: number) => onChange({ slots: config.slots.filter((_, idx) => idx !== i) });
  const addPreset = (preset: BacklogSlot) => onChange({ enabled: true, slots: [...config.slots, { ...preset }] });

  const glance = (() => {
    if (!status) return config.enabled ? 'Waiting for engine…' : 'Backlog autorun off';
    if (status.runningCardTitle) {
      const left = status.windowEndsAt ? ` · ${formatCountdown(status.windowEndsAt)} left` : '';
      return `Running: ${status.runningCardTitle}${left}`;
    }
    if (status.windowActive && status.windowEndsAt) {
      return `Window open · ${formatCountdown(status.windowEndsAt)} left${status.waitingForIdle ? ' · waiting for idle' : ''} · queue: ${status.queueReady} ready`;
    }
    if (status.nextWindowStartAt) {
      return `Next window ${formatDayClock(status.nextWindowStartAt)} · queue: ${status.queueReady} ready`;
    }
    if (config.enabled) return 'No windows configured — add one below';
    // Surface configured-but-dormant windows so "+ Add window" (which doesn't
    // flip the master toggle, unlike the presets) doesn't look like a no-op.
    return config.slots.length > 0
      ? `Backlog autorun off — ${config.slots.length} window${config.slots.length === 1 ? '' : 's'} configured, enable to arm`
      : 'Backlog autorun off';
  })();

  return (
    <section className='mt-6 bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <h2 className='text-lg font-bold text-strong'>Backlog Scheduler</h2>
          <p className='text-sm text-muted mt-1'>
            Time windows when queued cards from the <span className='text-body'>Backlog</span> board
            auto-execute — night hours, weekends. Green cards only, one at a time, research reports only in
            this phase. Turns idle window credit into finished work.
          </p>
        </div>
        <Toggle on={config.enabled} onClick={() => onChange({ enabled: !config.enabled })} label='Toggle backlog scheduler' />
      </div>

      {/* Status glance */}
      <div className='mt-4 bg-glass/50 border border-edge/60 rounded-xl px-4 py-3'>
        <p className='text-sm text-strong'>{glance}</p>
        {status?.usagePausedUntil != null && status.usagePausedUntil > Date.now() && (
          <p className='text-xs mt-1 text-warn/90'>
            usage window exhausted · resumes ~{formatClock(status.usagePausedUntil)}
          </p>
        )}
        {status?.lastRun && (
          <p className='text-xs mt-1 text-muted'>
            Last run {formatClock(status.lastRun.at)} — {status.lastRun.cardTitle}:{' '}
            <span className={status.lastRun.outcome === 'success' ? 'text-ok' : 'text-warn'}>
              {status.lastRun.outcome}
            </span>
          </p>
        )}
        {status?.forecast && status.forecast.cardCount > 0 && (
          <p className='text-xs mt-1 text-faint'>
            Queue will burn ~{formatUsd(status.forecast.totalCostUsd)} in the next window
            ({status.forecast.cardCount} card{status.forecast.cardCount === 1 ? '' : 's'} fit).
          </p>
        )}
      </div>

      {/* Windows editor */}
      <div className='mt-5'>
        <div className='flex items-center justify-between mb-3 flex-wrap gap-2'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Windows</p>
          <div className='flex gap-2'>
            <button
              onClick={() => addPreset(PRESET_NIGHTS)}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-control hover:bg-control-strong text-primary cursor-pointer transition-colors'
            >
              Nights 23–07 Mon–Fri
            </button>
            <button
              onClick={() => addPreset(PRESET_WEEKENDS)}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-control hover:bg-control-strong text-primary cursor-pointer transition-colors'
            >
              Weekends
            </button>
            <button
              onClick={addSlot}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors'
            >
              + Add window
            </button>
          </div>
        </div>
        {config.slots.length === 0 ? (
          <p className='text-sm text-muted'>No windows yet. Add one, or use a preset — overnight ranges (23:00–07:00) belong to their start day.</p>
        ) : (
          <div className='flex flex-col gap-2'>
            {config.slots.map((slot, i) => (
              <SlotRow key={i} slot={slot} onChange={(next) => updateSlot(i, next)} onRemove={() => removeSlot(i)} />
            ))}
          </div>
        )}
      </div>

      {/* requireIdle gate */}
      <div className='mt-5 bg-glass/40 border border-edge/50 rounded-xl p-4 flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-strong text-sm leading-tight'>Only run while idle</p>
          <p className='text-xs text-muted mt-1'>
            Even inside a window, wait until the keyboard/mouse have been untouched for 5 minutes — so a
            late-night session of yours isn't interrupted by an agent claiming the queue.
          </p>
        </div>
        <Toggle
          small
          on={config.requireIdle}
          onClick={() => onChange({ requireIdle: !config.requireIdle })}
          label='Toggle idle requirement'
        />
      </div>

      {/* Completion notifications — collapsed behind a toggle so an empty list
          doesn't clutter the section; expands inline (no screen-covering modal). */}
      <div className='mt-5 bg-glass/40 border border-edge/50 rounded-xl p-4'>
        <div className='flex items-start gap-3'>
          <div className='flex-1 min-w-0'>
            <p className='font-medium text-strong text-sm leading-tight'>Task notifications</p>
            <p className='text-xs text-muted mt-1'>
              Ping a Discord/Slack channel when a card finishes — <span className='text-ok'>done</span>,{' '}
              <span className='text-danger'>blocked</span>, or <span className='text-warn'>rework</span>. Get told on
              your phone the moment a queued task lands, without watching the board.
            </p>
          </div>
          <button
            onClick={() => setNotificationsOpen((v) => !v)}
            aria-expanded={notificationsOpen}
            className='shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-control hover:bg-control-strong text-primary cursor-pointer transition-colors'
          >
            {notificationsOpen ? 'Hide' : activeWebhooks > 0 ? `Configure · ${activeWebhooks} active` : 'Configure'}
          </button>
        </div>

        {notificationsOpen && (
          <div className='mt-4 flex flex-col gap-3 border-t border-edge/40 pt-4'>
            <p className='text-xs text-faint'>
              Create a webhook in Discord (Server Settings → Integrations → Webhooks) or Slack (Incoming Webhooks).
              Paused / usage-limit runs auto-resume, so they stay silent.
            </p>
            {webhooks.length === 0 ? (
              <p className='text-xs text-faint italic'>No webhooks yet — add one to get pinged on completion.</p>
            ) : (
              webhooks.map((w) => (
                <WebhookRow
                  key={w.id}
                  target={w}
                  onChange={(next) => changeWebhook(w.id, next)}
                  onDelete={() => deleteWebhook(w.id)}
                />
              ))
            )}
            <button
              onClick={addWebhook}
              className='self-start px-3 py-1.5 rounded-lg text-xs font-medium bg-control/60 hover:bg-control text-primary cursor-pointer transition-colors'
            >
              + Add webhook
            </button>
          </div>
        )}
      </div>

      <p className='text-xs text-faint mt-4'>
        Sequential in this phase: one card at a time, each with a hard time budget. A card still running at
        window end gets a 10-minute grace period, then pauses and resumes first in the next window. Backlog
        runs anchor 5-hour windows themselves, so Cowork opener pings are skipped while a card is running.
      </p>
    </section>
  );
};
