import React, { useEffect, useMemo, useState } from 'react';
import { GuardrailConfig, GuardrailEvent, GuardrailRule, GuardrailTier, GuardrailOs } from '../../../common/guardrails';
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

const TIER_LABELS: Record<GuardrailTier, string> = {
  mustBlock: 'Block',
  warn:      'Warn',
};

const TIER_STYLES: Record<GuardrailTier, string> = {
  mustBlock: 'bg-red-500/15 border-red-500/30 text-red-300',
  warn:      'bg-amber-500/15 border-amber-500/30 text-amber-300',
};

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
    return (
      <div className='flex items-center gap-3 text-slate-400'>
        <div className='w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin' />
        Loading guardrails…
      </div>
    );
  }

  return (
    <div>
      <div className='flex items-center justify-between mb-5'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Command Guardrails</h2>
          <p className='text-sm text-slate-400 mt-1'>
            Inspect shell commands before tools run them. Blocking works for tools that honour PreToolUse responses; everything else gets a warning.
          </p>
        </div>
        <button
          onClick={() => update({ enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.enabled ? 'bg-blue-500' : 'bg-slate-600'
          }`}
          aria-label='Toggle guardrails'
          title={config.enabled ? 'Guardrails ON' : 'Guardrails OFF'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Rule list */}
      <div className='bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl'>
        <div className='flex items-center justify-between mb-4'>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500'>
            Rules ({allRules.length})
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className='px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors'
          >
            + Add rule
          </button>
        </div>

        <div className='flex flex-col gap-2'>
          {allRules.map((rule) => {
            const isDisabled = config.disabledRuleIds.includes(rule.id);
            const isCustom = rule.source === 'user';
            return (
              <div
                key={rule.id}
                className={`flex items-start gap-3 p-3 rounded-xl border ${
                  isDisabled
                    ? 'bg-slate-900/40 border-slate-700/40 opacity-50'
                    : 'bg-slate-900/60 border-slate-700/60'
                }`}
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${TIER_STYLES[rule.tier]} shrink-0 mt-0.5`}
                >
                  {TIER_LABELS[rule.tier]}
                </span>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <code className='text-xs text-slate-300 font-mono truncate'>{rule.id}</code>
                    <span className='text-[10px] text-slate-500'>
                      {rule.os.join(', ')}
                    </span>
                    {isCustom && (
                      <span className='text-[10px] text-blue-400 font-medium'>custom</span>
                    )}
                  </div>
                  <p className='text-sm text-slate-300 mt-0.5'>{rule.message}</p>
                  <code className='text-[10px] text-slate-500 font-mono break-all'>/{rule.pattern}/{rule.flags ?? ''}</code>
                  {rule.suggestedFix && (
                    <p className='text-[11px] text-slate-400 mt-1 italic'>→ {rule.suggestedFix}</p>
                  )}
                </div>
                <div className='flex flex-col items-end gap-1 shrink-0'>
                  <button
                    onClick={() => toggleRule(rule.id, !isDisabled)}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer ${
                      !isDisabled ? 'bg-blue-500' : 'bg-slate-600'
                    }`}
                    aria-label={isDisabled ? 'Enable rule' : 'Disable rule'}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                        !isDisabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  {isCustom && (
                    <button
                      onClick={() => removeCustomRule(rule.id)}
                      className='text-[10px] text-slate-500 hover:text-red-400 cursor-pointer transition-colors'
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent events */}
      <div className='bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl mt-5'>
        <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3'>
          Recent activity {events.length > 0 && `(${events.length})`}
        </p>
        {events.length === 0 ? (
          <p className='text-sm text-slate-500 italic'>No guardrail events yet.</p>
        ) : (
          <div className='flex flex-col gap-2 max-h-72 overflow-y-auto apple-scroll'>
            {events.map((evt, i) => (
              <div
                key={`${evt.ts}-${i}`}
                className='flex items-start gap-3 p-2.5 rounded-lg bg-slate-900/60 border border-slate-700/40'
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                    evt.decision === 'block'
                      ? 'bg-red-500/15 border-red-500/30 text-red-300'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {evt.decision}
                </span>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 text-[10px] text-slate-500'>
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
                  <code className='text-xs text-slate-300 font-mono break-all'>{evt.command}</code>
                  <p className='text-[11px] text-slate-400 mt-0.5'>
                    {evt.matched.map(m => m.ruleId).join(', ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddRuleModal
          onClose={() => setShowAdd(false)}
          onSaved={(nextCfg) => { setConfig(nextCfg); setShowAdd(false); }}
        />
      )}
    </div>
  );
};

// ── Add custom rule modal ────────────────────────────────────────────────────

interface AddRuleModalProps {
  onClose: () => void;
  onSaved: (cfg: GuardrailConfig) => void;
}

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
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='apple-scroll relative w-full max-w-lg mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>
        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'>New rule</p>
          <h2 className='text-lg font-bold text-white'>Custom guardrail</h2>
        </div>

        <Field label='ID'>
          <input
            value={id} onChange={(e) => setId(e.target.value)}
            placeholder='e.g. block-prod-deploy'
            className={inputCls}
          />
        </Field>

        <Field label='Pattern (regex)'>
          <input
            value={pattern} onChange={(e) => setPattern(e.target.value)}
            placeholder='e.g. \\bdeploy\\s+prod\\b'
            className={inputCls + ' font-mono'}
          />
        </Field>

        <Field label='Flags'>
          <input
            value={flags} onChange={(e) => setFlags(e.target.value)}
            placeholder='i'
            className={inputCls + ' font-mono w-24'}
          />
        </Field>

        <Field label='Tier'>
          <div className='flex gap-2'>
            {(['mustBlock', 'warn'] as GuardrailTier[]).map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                  tier === t ? TIER_STYLES[t] : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>
        </Field>

        <Field label='OS'>
          <div className='flex gap-2 flex-wrap'>
            {OS_OPTIONS.map(({ id: o, label }) => (
              <button
                key={o}
                onClick={() => toggleOs(o)}
                className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors border ${
                  osSet.has(o)
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label='Message'>
          <input
            value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder='Why this command is risky.'
            className={inputCls}
          />
        </Field>

        <Field label='Suggested fix (optional)'>
          <input
            value={suggestedFix} onChange={(e) => setSuggestedFix(e.target.value)}
            placeholder='What to do instead.'
            className={inputCls}
          />
        </Field>

        {error && (
          <p className='text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2'>
            {error}
          </p>
        )}

        <div className='flex justify-end gap-2 mt-2'>
          <button
            onClick={onClose}
            className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 cursor-pointer transition-colors'
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors disabled:opacity-50'
          >
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      </div>
    </div>
  );
};

const inputCls =
  'w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className='text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5'>{label}</p>
    {children}
  </div>
);
