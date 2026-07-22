import React, { useState } from 'react';
import { WebhookKind, WebhookTarget } from '../../../common/types';
import { logger } from '../../../common/logger';
import { Select, GlassToggle, Tooltip } from '../Shared';

// One editable Discord/Slack webhook row: platform picker, label, enable toggle,
// delete, URL, and a "Send test" button. Shared by the attention-escalation
// section and the backlog completion-notifications modal — both send the same
// WebhookTarget shape. The test-send is outcome-agnostic (it POSTs a generic
// "Agent Pulse test" message), so both callers reuse the attention:test-webhook
// IPC channel; override via `testChannel` if a caller ever needs its own.

const KIND_OPTIONS: { id: WebhookKind; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'slack', label: 'Slack' },
];

export const WebhookRow: React.FC<{
  target: WebhookTarget;
  onChange: (next: WebhookTarget) => void;
  onDelete: () => void;
  testChannel?: string;
}> = ({ target, onChange, onDelete, testChannel = 'attention:test-webhook' }) => {
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');

  const sendTest = async () => {
    setTestState('sending');
    try {
      const res = await window.electron.invoke(testChannel, target);
      setTestState(res?.ok ? 'ok' : 'fail');
    } catch (e) {
      logger.warn('[WebhookRow] test webhook failed', e);
      setTestState('fail');
    }
    window.setTimeout(() => setTestState('idle'), 3000);
  };

  const testLabel =
    testState === 'sending' ? 'Sending…' : testState === 'ok' ? '✓ Sent' : testState === 'fail' ? '✗ Failed' : 'Send test';

  return (
    <div className='glass-secondary flex flex-col gap-2 px-4 py-3'>
      <div className='flex items-center gap-2'>
        <Select<WebhookKind>
          value={target.kind}
          onChange={(kind) => onChange({ ...target, kind })}
          ariaLabel='Webhook platform'
          className='px-2 py-1.5 text-sm w-28'
          options={KIND_OPTIONS.map((k) => ({ value: k.id, label: k.label }))}
        />
        <input
          type='text'
          value={target.label ?? ''}
          onChange={(e) => onChange({ ...target, label: e.target.value })}
          placeholder='Label (optional)'
          className='glass-secondary rounded-lg flex-1 px-3 py-1.5 text-sm text-primary placeholder:text-faint'
        />
        <GlassToggle
          checked={target.enabled}
          onChange={(next) => onChange({ ...target, enabled: next })}
          size='sm'
          label='Toggle webhook'
        />
        <Tooltip content='Delete webhook'>
          <button
            onClick={onDelete}
            className='px-2 py-1.5 rounded-lg text-xs font-medium bg-control/60 hover:bg-red-600/70 text-body hover:text-white cursor-pointer transition-colors'
            aria-label='Delete webhook'
          >
            ✕
          </button>
        </Tooltip>
      </div>
      <div className='flex items-center gap-2'>
        <input
          type='url'
          value={target.url}
          onChange={(e) => onChange({ ...target, url: e.target.value })}
          placeholder={target.kind === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'}
          className='glass-secondary rounded-lg flex-1 px-3 py-1.5 text-sm text-primary placeholder:text-faint font-mono'
        />
        <button
          onClick={sendTest}
          disabled={!target.url.trim() || testState === 'sending'}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            testState === 'ok'
              ? 'bg-green-600/70 text-white'
              : testState === 'fail'
                ? 'bg-red-600/70 text-white'
                : 'bg-control/70 hover:bg-control-strong text-primary'
          }`}
        >
          {testLabel}
        </button>
      </div>
    </div>
  );
};
