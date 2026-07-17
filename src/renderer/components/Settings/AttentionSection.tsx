import React from 'react';
import { AttentionConfig, WebhookTarget } from '../../../common/types';
import { WebhookRow } from './WebhookRow';

interface Props {
  config: AttentionConfig;
  onChange: (partial: Partial<AttentionConfig>) => void;
}

// Threshold presets (seconds) offered as quick picks; the slider covers the rest.
const THRESHOLD_MIN = 5;
const THRESHOLD_MAX = 300;

// A small pill toggle reused for the boolean rows.
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({
  checked,
  onChange,
  label,
  hint,
}) => (
  <button
    onClick={() => onChange(!checked)}
    className='flex items-center gap-3 text-left cursor-pointer'
  >
    <span
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-blue-600' : 'bg-control-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </span>
    <span>
      <span className='text-sm font-medium text-primary'>{label}</span>
      {hint && <span className='text-xs text-faint ml-2'>{hint}</span>}
    </span>
  </button>
);

export const AttentionSection: React.FC<Props> = ({ config, onChange }) => {
  const updateWebhooks = (webhooks: WebhookTarget[]) => onChange({ webhooks });

  const addWebhook = () => {
    // Renderer can't use Math.random in some harnesses, but here it's a normal
    // browser context — fine for a local UI id.
    const id = `wh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    updateWebhooks([...config.webhooks, { id, kind: 'discord', url: '', enabled: true }]);
  };

  const changeWebhook = (id: string, next: WebhookTarget) =>
    updateWebhooks(config.webhooks.map((w) => (w.id === id ? next : w)));

  const deleteWebhook = (id: string) =>
    updateWebhooks(config.webhooks.filter((w) => w.id !== id));

  const disabled = !config.enabled;

  return (
    <section className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-6 shadow-xl flex flex-col gap-7'>
      <div>
        <h2 className='text-lg font-bold text-strong'>“Needs you” escalation</h2>
        <p className='text-sm text-muted mt-1'>
          When an agent finishes and waits on you, escalate after a set time — intensify the bubble and ping your chat.
        </p>
      </div>

      {/* Master switch */}
      <Toggle
        checked={config.enabled}
        onChange={(v) => onChange({ enabled: v })}
        label='Escalate when an agent waits for you'
      />

      <div className={`flex flex-col gap-7 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Threshold */}
        <div className='flex flex-col gap-3'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Escalate after</p>
          <div className='flex items-center gap-4'>
            <input
              type='range'
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              step={5}
              value={config.escalateAfterSeconds}
              onChange={(e) => onChange({ escalateAfterSeconds: Number(e.target.value) })}
              className='flex-1 cursor-pointer'
            />
            <span className='text-sm font-medium text-strong tabular-nums w-16 text-right'>
              {config.escalateAfterSeconds}s
            </span>
          </div>
          <p className='text-xs text-faint'>
            How long a tool sits in “waiting for input” before Agent Pulse escalates.
          </p>
        </div>

        {/* Channels */}
        <div className='flex flex-col gap-3'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>On escalation</p>
          <Toggle
            checked={config.intensifyBubble}
            onChange={(v) => onChange({ intensifyBubble: v })}
            label='Intensify the bubble'
            hint='Urgent pulse + bell badge'
          />
          <Toggle
            checked={config.osNotification}
            onChange={(v) => onChange({ osNotification: v })}
            label='Desktop notification'
            hint='Native OS notification'
          />
        </div>

        {/* Webhooks */}
        <div className='flex flex-col gap-3'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Discord / Slack webhooks</p>
          <p className='text-xs text-muted -mt-1'>
            POSTed when escalation fires. Create one in Discord (Server Settings → Integrations → Webhooks) or Slack (Incoming Webhooks).
          </p>
          {config.webhooks.length === 0 && (
            <p className='text-xs text-faint italic'>No webhooks yet.</p>
          )}
          {config.webhooks.map((w) => (
            <WebhookRow
              key={w.id}
              target={w}
              onChange={(next) => changeWebhook(w.id, next)}
              onDelete={() => deleteWebhook(w.id)}
            />
          ))}
          <button
            onClick={addWebhook}
            className='self-start px-4 py-2 rounded-lg text-sm font-medium bg-control/60 hover:bg-control text-primary cursor-pointer transition-colors'
          >
            + Add webhook
          </button>
        </div>
      </div>
    </section>
  );
};
