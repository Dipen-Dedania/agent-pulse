import React from 'react';
import { AttentionConfig, ScreenEdgeColor, ScreenEdgeSpeed, ScreenEdgeStyle, WebhookTarget } from '../../../common/types';
import { WebhookRow } from './WebhookRow';
import { GlassToggle, Button, Card, Eyebrow, Segmented, SegmentedOption, SettingRow, Tooltip } from '../Shared';

interface Props {
  config: AttentionConfig;
  onChange: (partial: Partial<AttentionConfig>) => void;
}

// Threshold presets (seconds) offered as quick picks; the slider covers the rest.
const THRESHOLD_MIN = 5;
const THRESHOLD_MAX = 300;

// Ambient border options. Dot classes are literal so Tailwind keeps them; they
// mirror EDGE_PALETTES[*].brand in common/screenEdge.ts.
const EDGE_STYLE_OPTIONS: SegmentedOption[] = [
  { value: 'glow', label: 'Glow', hint: 'A soft glow breathes in from every edge.' },
  { value: 'comet', label: 'Comet', hint: 'A comet laps the screen edge and lands next to the tray (or on the notch of a notched MacBook).' },
];
const EDGE_COLOR_OPTIONS: SegmentedOption[] = [
  { value: 'blue', label: 'Blue', dot: 'bg-[#3b82f6]', hint: 'Status colour for “waiting”' },
  { value: 'green', label: 'Green', dot: 'bg-[#22c55e]' },
  { value: 'purple', label: 'Purple', dot: 'bg-[#9b5cf6]' },
  { value: 'orange', label: 'Orange', dot: 'bg-[#f59e0b]' },
  { value: 'pink', label: 'Pink', dot: 'bg-[#ec4899]' },
  { value: 'silver', label: 'Silver', dot: 'bg-[#cbd5e1]' },
];
const EDGE_SPEED_OPTIONS: SegmentedOption[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];

// A titled toggle row (control on the right) reused for the boolean rows.
const Toggle: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, hint, disabled }) => (
  <SettingRow
    title={label}
    description={hint}
    control={
      <GlassToggle
        checked={checked}
        onChange={onChange}
        size='md'
        label={label}
        disabled={disabled}
      />
    }
  />
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
  const isLinux = window.electron.platform === 'linux';

  return (
    <Card
      title='“Needs you” escalation'
      subtitle='When an agent finishes and waits on you, escalate after a set time — intensify the bubble and ping your chat.'
    >
    <div className='flex flex-col gap-7'>
      {/* Master switch */}
      <Toggle
        checked={config.enabled}
        onChange={(v) => onChange({ enabled: v })}
        label='Escalate when an agent waits for you'
      />

      {/* Ambient screen-edge glow — fires the instant an agent waits, so it
          lives outside the escalation block (independent of the threshold).
          Unavailable on Linux: click-through overlays are unreliable there and
          a non-click-through full-screen window locks the whole desktop, so the
          main process hard-disables it (ScreenEdgeManager.SUPPORTED) and this
          UI greys out with an explanatory tooltip. */}
      <div className='flex flex-col gap-3'>
        <Eyebrow>Ambient screen border</Eyebrow>
        <Tooltip
          content={
            isLinux
              ? 'Not available on Linux — the full-screen overlay can’t reliably let clicks through, which would block the mouse on the whole desktop.'
              : undefined
          }
        >
          <div className={`flex flex-col gap-3 ${isLinux ? 'opacity-40' : ''}`}>
            <Toggle
              checked={!isLinux && config.screenEdgeGlow}
              onChange={(v) => onChange({ screenEdgeGlow: v })}
              label='Light the screen edges while waiting'
              hint={isLinux ? 'Not available on Linux' : 'Instant · all displays'}
              disabled={isLinux}
            />
            <SettingRow
              title='Style'
              control={
                <Segmented
                  ariaLabel='Border style'
                  options={EDGE_STYLE_OPTIONS}
                  value={config.screenEdgeStyle}
                  onChange={(v) => onChange({ screenEdgeStyle: v as ScreenEdgeStyle })}
                />
              }
            />
            <SettingRow
              title='Color'
              control={
                <Segmented
                  ariaLabel='Border color'
                  size='xs'
                  wrap
                  className='justify-end'
                  options={EDGE_COLOR_OPTIONS}
                  value={config.screenEdgeColor}
                  onChange={(v) => onChange({ screenEdgeColor: v as ScreenEdgeColor })}
                />
              }
            />
            <SettingRow
              title='Speed'
              description={config.screenEdgeStyle === 'comet' ? 'How fast the comet laps the screen' : 'How fast the glow breathes'}
              control={
                <Segmented
                  ariaLabel='Border speed'
                  options={EDGE_SPEED_OPTIONS}
                  value={config.screenEdgeSpeed}
                  onChange={(v) => onChange({ screenEdgeSpeed: v as ScreenEdgeSpeed })}
                />
              }
            />
            <div className='flex items-center gap-3'>
              <Button
                variant='secondary'
                disabled={isLinux}
                onClick={() => window.electron.invoke('screen-edge:preview')}
              >
                Preview
              </Button>
              <span className='text-xs text-faint'>
                {config.screenEdgeStyle === 'comet'
                  ? 'Plays one lap of the comet on every display.'
                  : 'Flashes the border for a few seconds.'}
              </span>
            </div>
          </div>
        </Tooltip>
      </div>

      <div className={`flex flex-col gap-7 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Threshold */}
        <div className='flex flex-col gap-3'>
          <Eyebrow>Escalate after</Eyebrow>
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
          <Eyebrow>On escalation</Eyebrow>
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
          <Eyebrow>Discord / Slack webhooks</Eyebrow>
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
          <Button
            variant='secondary'
            onClick={addWebhook}
            className='self-start'
          >
            + Add webhook
          </Button>
        </div>
      </div>
    </div>
    </Card>
  );
};
