import React, { useEffect, useRef, useState } from 'react';
import { CraftCoachingResult } from '../../../../../common/timeline-types';
import { formatUsd } from '../../../../../common/pricing';
import { Button, Spinner } from '../../../Shared';
import { useGlobalRange } from '../rangeContext';
import { Card, InfoTooltip } from '../shared';
import { TipIcon } from './craftUi';

const PRIVACY_NOTE =
  'Sends only the numbers in the scorecard above (counts, medians and percentages) to a short ' +
  'headless Claude CLI run on a small model with every tool and MCP server turned off. Your prompt ' +
  'text is never stored by Agent Pulse, so it cannot be sent. The run is billed to your Claude ' +
  'account like other headless (Agent SDK) usage.';

function ago(ts: number): string {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const CoachingCard: React.FC = () => {
  const range = useGlobalRange();
  const [result, setResult] = useState<CraftCoachingResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores a response that arrives after the range changed under it.
  const requestRef = useRef(0);

  // Show the last answer for this range, if any, without starting a run.
  useEffect(() => {
    const id = ++requestRef.current;
    setResult(null);
    setError(null);
    setRunning(false);
    window.electron.invoke('analytics:get-coaching', { range, peek: true })
      .then((r: CraftCoachingResult | null) => {
        if (requestRef.current === id && r?.ok) setResult(r);
      })
      .catch(() => { /* peek is best-effort */ });
  }, [range]);

  const run = async () => {
    const id = ++requestRef.current;
    setRunning(true);
    setError(null);
    try {
      const r: CraftCoachingResult | null = await window.electron.invoke('analytics:get-coaching', { range, force: true });
      if (requestRef.current !== id) return;
      if (!r) setError('Coaching is unavailable while the Pulse Timeline is not running.');
      else if (!r.ok) setError(r.reason ?? 'Coaching failed.');
      else setResult(r);
    } catch {
      if (requestRef.current === id) setError('Coaching failed. See the app log.');
    } finally {
      if (requestRef.current === id) setRunning(false);
    }
  };

  return (
    <Card
      title='Personalised coaching'
      subtitle='Ask Claude for suggestions based on your numbers. Runs only when you click.'
      right={
        <InfoTooltip label='What gets sent'>
          <span className='text-[11px] text-body leading-snug'>{PRIVACY_NOTE}</span>
        </InfoTooltip>
      }
    >
      {result && (
        <ul className='flex flex-col gap-2 mb-4'>
          {result.tips.map((tip, i) => (
            <li key={i} className='text-xs text-body leading-snug flex gap-2'>
              <TipIcon className='text-info shrink-0 mt-px' />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className='text-xs text-warn mb-3 leading-snug'>{error}</p>}

      <div className='flex items-center gap-3 flex-wrap'>
        <Button variant={result ? 'secondary' : 'primary'} size='sm' onClick={run} disabled={running}>
          {running ? 'Thinking…' : result ? 'Refresh coaching' : 'Get personalised coaching'}
        </Button>
        {running && <Spinner size='sm' />}
        {result && !running && (
          <span className='text-[11px] text-faint'>
            Generated {ago(result.generatedAt)}
            {result.costUsd != null && ` · ${formatUsd(result.costUsd)}`}
          </span>
        )}
      </div>
    </Card>
  );
};
