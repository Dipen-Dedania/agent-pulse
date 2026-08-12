import React, { useState } from 'react';
import { WebhookKind, WebhookTarget } from '../../../common/types';
import { logger } from '../../../common/logger';
import { Select, Button, GlassToggle, IconButton, Input, Tooltip } from '../Shared';

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
        <Input
          type='text'
          value={target.label ?? ''}
          onChange={(e) => onChange({ ...target, label: e.target.value })}
          placeholder='Label (optional)'
          className='flex-1 min-w-0'
        />
        <GlassToggle
          checked={target.enabled}
          onChange={(next) => onChange({ ...target, enabled: next })}
          size='sm'
          label='Toggle webhook'
        />
        <Tooltip content='Delete webhook'>
          <IconButton shape='square' tone='danger' onClick={onDelete} aria-label='Delete webhook'>
            ✕
          </IconButton>
        </Tooltip>
      </div>
      <div className='flex items-center gap-2'>
        <Input
          type='url'
          value={target.url}
          onChange={(e) => onChange({ ...target, url: e.target.value })}
          placeholder={target.kind === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'}
          className='flex-1 min-w-0 font-mono'
        />
        <Button
          size='sm'
          variant={testState === 'ok' ? 'success' : testState === 'fail' ? 'danger' : 'secondary'}
          onClick={sendTest}
          disabled={!target.url.trim() || testState === 'sending'}
          className='shrink-0'
        >
          {testLabel}
        </Button>
      </div>
    </div>
  );
};
