import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { GuardrailConfig, GuardrailEvent, GuardrailRule, GuardrailTier, GuardrailOs } from '../../../common/guardrails';
import { Badge, Button, GlassToggle, Input, Segmented, Checkbox, Modal, appConfirm, type BadgeTone } from '../Shared';
import { Field, RuleRow, TabLoading } from './settingsShared';
import { logger } from '../../../common/logger';

// Serialized form of a GuardrailRule as it crosses IPC — RegExp doesn't
// survive structured clone, so patterns are always strings here.
interface WireRule extends Omit<GuardrailRule, 'pattern'> {
  pattern: string;
  flags?: string;
}

const OS_OPTIONS: { id: GuardrailOs; label: string }[] = [
  { id: 'all',   label: 'All' },
  { id: 'win',   label: 'Windows' },
  { id: 'mac',   label: 'macOS' },
  { id: 'linux', label: 'Linux' },
];

// Regex flags that meaningfully affect command matching. `i` (case-insensitive)
// is on by default; global/sticky/unicode don't change whether a pattern hits.
const FLAG_OPTIONS: { id: string; label: string }[] = [
  { id: 'i', label: 'Ignore case (i)' },
  { id: 'm', label: 'Multiline (m)' },
  { id: 's', label: 'Dotall (s)' },
];

const TIER_LABELS: Record<GuardrailTier, string> = {
  mustBlock: 'Block',
  warn:      'Warn',
};

const TIER_TONES: Record<GuardrailTier, BadgeTone> = {
  mustBlock: 'danger',
  warn:      'warn',
};

const TierBadge: React.FC<{ tier: GuardrailTier }> = ({ tier }) => (
  <Badge tone={TIER_TONES[tier]} variant='pill' size='xs' weight='semibold'>
    {TIER_LABELS[tier]}
  </Badge>
);

export const GuardrailsTab: React.FC = () => {
  const [config, setConfig] = useState<GuardrailConfig | null>(null);
  const [coreRules, setCoreRules] = useState<WireRule[]>([]);
  const [events, setEvents] = useState<GuardrailEvent[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  // Load existing config + the static core rule list once on mount.
  useEffect(() => {
    Promise.all([
      window.electron.invoke('guardrails:get-config'),
      window.electron.invoke('guardrails:list-core-rules'),
      window.electron.invoke('guardrails:get-recent-events').catch(() => []),
    ]).then(([cfg, rules, recent]) => {
      setConfig(cfg);
      setCoreRules(rules);
      setEvents(recent ?? []);
    }).catch((e) => logger.error('[GuardrailsTab] init failed', e));

    const handler = (_e: unknown, event: GuardrailEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    };
    window.electron.on('guardrail:event', handler);
    return () => window.electron.off('guardrail:event', handler);
  }, []);

  const update = async (partial: Partial<GuardrailConfig>) => {
    const next = await window.electron.invoke('guardrails:update-config', partial);
    setConfig(next);
  };

  const toggleRule = async (ruleId: string, disabled: boolean) => {
    if (!config) return;
    const next = disabled
      ? [...new Set([...config.disabledRuleIds, ruleId])]
      : config.disabledRuleIds.filter((id) => id !== ruleId);
    await update({ disabledRuleIds: next });
  };

  const removeCustomRule = async (ruleId: string) => {
    const ok = await appConfirm({
      title: 'Delete this guardrail?',
      message: `“${ruleId}” will be removed permanently. Core rules can be turned off instead of deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const next = await window.electron.invoke('guardrails:remove-custom-rule', ruleId);
    setConfig(next);
  };

  const allRules: WireRule[] = useMemo(() => {
    if (!config) return coreRules;
    return [
      ...coreRules,
      ...config.customRules.map((r) => ({
        ...r,
        pattern: typeof r.pattern === 'string' ? r.pattern : String(r.pattern),
        flags:   r.flags ?? 'i',
      })),
    ];
  }, [coreRules, config]);

  if (!config) {
    return <TabLoading label='Loading guardrails…' />;
  }

  return (
    <div>
      <div className='flex items-center justify-between mb-5'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Command Guardrails</h2>
          <p className='text-sm text-muted mt-1'>
            Inspect shell commands before tools run them. Some agents (Claude Code, Codex, Grok, Antigravity,
            OpenCode) can block a risky command outright; others just get a warning.
          </p>
        </div>
        <GlassToggle
          checked={config.enabled}
          onChange={() => update({ enabled: !config.enabled })}
          size='lg'
          label='Toggle guardrails'
        />
      </div>

      {!config.enabled && (
        <div className='bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-5'>
          <p className='text-sm text-warn/90'>
            <span className='font-semibold'>Guardrails are off.</span> Commands run without inspection —
            nothing below is enforced until you turn guardrails back on.
          </p>
        </div>
      )}

      <div className={config.enabled ? '' : 'opacity-60 pointer-events-none'}>
        {/* Rule list */}
        <div className='glass-primary p-5'>
          <div className='flex items-center justify-between mb-4'>
            <p className='text-xs font-semibold uppercase tracking-widest text-faint'>
              Rules ({allRules.length})
            </p>
            <Button variant='primary' size='sm' onClick={() => setShowAdd(true)}>
              + Add rule
            </Button>
          </div>

          <div className='flex flex-col gap-2'>
            {allRules.map((rule) => (
              <RuleRow
                key={rule.id}
                badge={<TierBadge tier={rule.tier} />}
                title={<code className='text-xs text-body font-mono truncate'>{rule.id}</code>}
                meta={<span className='text-[10px] text-faint'>{rule.os.join(', ')}</span>}
                isCustom={rule.source === 'user'}
                message={rule.message}
                subtext={
                  <code className='text-[10px] text-muted font-mono break-all'>
                    /{rule.pattern}/{rule.flags ?? ''}
                  </code>
                }
                hint={rule.suggestedFix}
                enabled={!config.disabledRuleIds.includes(rule.id)}
                onToggle={() => toggleRule(rule.id, !config.disabledRuleIds.includes(rule.id))}
                toggleLabel={config.disabledRuleIds.includes(rule.id) ? 'Enable rule' : 'Disable rule'}
                onDelete={rule.source === 'user' ? () => removeCustomRule(rule.id) : undefined}
              />
            ))}
          </div>
        </div>

        {/* Recent events */}
        <div className='glass-primary p-5 mt-5'>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>
            Recent activity {events.length > 0 && `(${events.length})`}
          </p>
          {events.length === 0 ? (
            <p className='text-sm text-faint italic'>No guardrail events yet.</p>
          ) : (
            <div className='flex flex-col gap-2 max-h-72 overflow-y-auto apple-scroll'>
              {events.map((evt, i) => (
                <div
                  key={`${evt.ts}-${i}`}
                  className='glass-secondary rounded-lg flex items-start gap-3 p-2.5'
                >
                  <Badge
                    tone={evt.decision === 'block' ? 'danger' : 'warn'}
                    variant='pill'
                    size='xs'
                    weight='semibold'
                    className='shrink-0'
                  >
                    {evt.decision === 'block' ? 'Blocked' : 'Warned'}
                  </Badge>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 text-[10px] text-faint'>
                      <span>{new Date(evt.ts).toLocaleTimeString()}</span>
                      <span>·</span>
                      <span>{evt.toolId}</span>
                      {!evt.blockable && evt.decision === 'warn' && evt.matched.some(m => m.tier === 'mustBlock') && (
                        <>
                          <span>·</span>
                          <span className='italic'>blocking not supported</span>
                        </>
                      )}
                    </div>
                    <code className='text-xs text-body font-mono break-all'>{evt.command}</code>
                    <p className='text-[11px] text-muted mt-0.5'>
                      {evt.matched.map(m => m.ruleId).join(', ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddRuleModal
            onClose={() => setShowAdd(false)}
            onSaved={(nextCfg) => { setConfig(nextCfg); setShowAdd(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ── Add custom rule modal ────────────────────────────────────────────────────

interface AddRuleModalProps {
  onClose: () => void;
  onSaved: (cfg: GuardrailConfig) => void;
}

type PatternCheck = { ok: boolean; reason?: string };

const AddRuleModal: React.FC<AddRuleModalProps> = ({ onClose, onSaved }) => {
  const [id, setId] = useState('');
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('i');
  const [tier, setTier] = useState<GuardrailTier>('warn');
  const [osSet, setOsSet] = useState<Set<GuardrailOs>>(new Set(['all']));
  const [message, setMessage] = useState('');
  const [suggestedFix, setSuggestedFix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [patternCheck, setPatternCheck] = useState<PatternCheck | null>(null);

  const toggleOs = (os: GuardrailOs) => {
    setOsSet((prev) => {
      const next = new Set(prev);
      if (next.has(os)) next.delete(os); else next.add(os);
      // 'all' is exclusive — when chosen, drop the others.
      if (os === 'all' && next.has('all')) return new Set(['all']);
      if (os !== 'all' && next.has('all')) next.delete('all');
      if (next.size === 0) next.add('all');
      return next;
    });
  };

  const toggleFlag = (flag: string) => {
    setFlags((prev) => (prev.includes(flag) ? prev.replace(flag, '') : prev + flag));
  };

  // Live-validate the regex as the user types (debounced) so authoring feedback
  // arrives at the point of input, not only on Save.
  useEffect(() => {
    if (!pattern.trim()) { setPatternCheck(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const check = await window.electron.invoke('guardrails:validate-pattern', pattern);
        if (!cancelled) setPatternCheck(check);
      } catch {
        if (!cancelled) setPatternCheck({ ok: false, reason: 'could not validate' });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pattern]);

  const save = async () => {
    setError(null);
    if (!id.trim() || !pattern.trim() || !message.trim()) {
      setError('id, pattern, and message are required');
      return;
    }
    if (!/^[a-z0-9-]+$/i.test(id)) {
      setError('id must be alphanumeric / dash only');
      return;
    }
    setSaving(true);
    try {
      const check = await window.electron.invoke('guardrails:validate-pattern', pattern);
      if (!check.ok) {
        setError(check.reason ?? 'invalid pattern');
        setSaving(false);
        return;
      }
      const rule: GuardrailRule = {
        id: id.trim(),
        pattern: pattern,
        flags,
        os: Array.from(osSet),
        tier,
        message: message.trim(),
        suggestedFix: suggestedFix.trim() || undefined,
        source: 'user',
      };
      const next = await window.electron.invoke('guardrails:add-custom-rule', rule);
      onSaved(next);
    } catch (e) {
      setError((e as Error).message ?? 'failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      eyebrow='New rule'
      title='Custom guardrail'
      onClose={onClose}
      footer={
        <>
          <Button variant='secondary' size='md' onClick={onClose}>Cancel</Button>
          <Button variant='primary' size='md' onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save rule'}
          </Button>
        </>
      }
    >
      <Field label='ID'>
        <Input
          value={id} onChange={(e) => setId(e.target.value)}
          placeholder='e.g. block-prod-deploy'
          className='w-full'
        />
      </Field>

      <Field label='Pattern (regex)'>
        <Input
          value={pattern} onChange={(e) => setPattern(e.target.value)}
          placeholder='e.g. \bdeploy\s+prod\b'
          className='w-full font-mono'
        />
        {patternCheck && (
          <p className={`text-[11px] mt-1 ${patternCheck.ok ? 'text-ok' : 'text-danger'}`}>
            {patternCheck.ok ? '✓ Valid pattern' : `✗ ${patternCheck.reason ?? 'invalid pattern'}`}
          </p>
        )}
      </Field>

      <Field label='Flags'>
        <div className='flex gap-4 flex-wrap'>
          {FLAG_OPTIONS.map(({ id: f, label }) => (
            <Checkbox key={f} checked={flags.includes(f)} onChange={() => toggleFlag(f)} label={label} size='sm' />
          ))}
        </div>
      </Field>

      <Field label='Tier'>
        <Segmented
          options={[{ value: 'mustBlock', label: 'Block' }, { value: 'warn', label: 'Warn' }]}
          value={tier}
          onChange={(v) => setTier(v as GuardrailTier)}
        />
      </Field>

      <Field label='OS'>
        <div className='flex gap-4 flex-wrap'>
          {OS_OPTIONS.map(({ id: o, label }) => (
            <Checkbox key={o} checked={osSet.has(o)} onChange={() => toggleOs(o)} label={label} size='sm' />
          ))}
        </div>
      </Field>

      <Field label='Message'>
        <Input
          value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder='Why this command is risky.'
          className='w-full'
        />
      </Field>

      <Field label='Suggested fix (optional)'>
        <Input
          value={suggestedFix} onChange={(e) => setSuggestedFix(e.target.value)}
          placeholder='What to do instead.'
          className='w-full'
        />
      </Field>

      {error && (
        <p className='text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2'>
          {error}
        </p>
      )}
    </Modal>
  );
};
