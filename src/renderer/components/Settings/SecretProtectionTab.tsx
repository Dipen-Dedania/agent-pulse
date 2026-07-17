import React, { useEffect, useMemo, useState } from 'react';
import { SecretProtectionConfig, SecretRule, SecretAccessEvent } from '../../../common/secretProtection';
import { ToolId } from '../../../common/types';
import { TOOL_META } from '../../../common/toolMeta';
import { logger } from '../../../common/logger';

// Static per-agent coverage map (analysis §2.1 / §7.4). `installed`/`hooked`
// come from live detection; this table describes what protection each agent can
// receive and how strong it is.
type BadgeTone = 'hard' | 'soft' | 'bypass' | 'none';
const COVERAGE: Record<ToolId, { ignoreFile: boolean; hookBlock: boolean; badge: string; tone: BadgeTone }> = {
  'claude-code':     { ignoreFile: true,  hookBlock: true,  badge: 'Hook deny (soft)',        tone: 'soft' },
  'antigravity-cli': { ignoreFile: true,  hookBlock: true,  badge: 'Hook deny + built-in',    tone: 'soft' },
  'cursor':          { ignoreFile: true,  hookBlock: false, badge: 'Bypassable in agent mode',tone: 'bypass' },
  'vscode-copilot':  { ignoreFile: true,  hookBlock: false, badge: 'Not applied in agent mode',tone: 'bypass' },
  'openai-codex':    { ignoreFile: true,  hookBlock: false, badge: 'Sandbox (built-in)',      tone: 'hard' },
  'kiro':            { ignoreFile: false, hookBlock: false, badge: 'Unsupported',             tone: 'none' },
  // Grok: no Agent Pulse ignore-file writer yet; blocking rides the native HTTP
  // PreToolUse deny (Claude-compatible response shape).
  'grok':            { ignoreFile: false, hookBlock: true,  badge: 'Hook deny (soft)',        tone: 'soft' },
};

const TONE_CLS: Record<BadgeTone, string> = {
  hard:   'bg-emerald-500/15 border-emerald-500/30 text-ok',
  soft:   'bg-amber-500/15 border-amber-500/30 text-warn',
  bypass: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
  none:   'bg-control/40 border-edge-strong/40 text-muted',
};

interface DetectInfo { installed?: boolean; hookInstalled?: boolean }

// Secret Protection — gates what an agent is allowed to *read* (distinct from
// Command Guardrails, which gate what it runs). Modeled on GuardrailsTab.tsx so
// the two sub-tabs share a visual language without ever merging rule lists.

export const SecretProtectionTab: React.FC = () => {
  const [config, setConfig] = useState<SecretProtectionConfig | null>(null);
  const [coreRules, setCoreRules] = useState<SecretRule[]>([]);
  const [events, setEvents] = useState<SecretAccessEvent[]>([]);
  const [detected, setDetected] = useState<Partial<Record<ToolId, DetectInfo>>>({});
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electron.invoke('secret-protection:get-config'),
      window.electron.invoke('secret-protection:list-core-rules'),
      window.electron.invoke('secret-protection:get-recent-events').catch(() => []),
      window.electron.invoke('detect-tools').catch(() => ({})),
    ]).then(([cfg, rules, recent, tools]) => {
      setConfig(cfg);
      setCoreRules(rules);
      setEvents(recent ?? []);
      setDetected(tools ?? {});
    }).catch((e) => logger.error('[SecretProtectionTab] init failed', e));

    const handler = (_e: unknown, event: SecretAccessEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    };
    window.electron.on('secret-access:event', handler);
    return () => window.electron.off('secret-access:event', handler);
  }, []);

  const update = async (partial: Partial<SecretProtectionConfig>) => {
    const next = await window.electron.invoke('secret-protection:update-config', partial);
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
    const next = await window.electron.invoke('secret-protection:remove-custom-rule', ruleId);
    setConfig(next);
  };

  const allRules: SecretRule[] = useMemo(() => {
    if (!config) return coreRules;
    return [...coreRules, ...config.customRules];
  }, [coreRules, config]);

  if (!config) {
    return (
      <div className='flex items-center gap-3 text-muted'>
        <div className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
        Loading secret protection…
      </div>
    );
  }

  return (
    <div>
      <div className='flex items-center justify-between mb-5'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Secret Protection</h2>
          <p className='text-sm text-muted mt-1'>
            Stop agents from reading secret files (.env, keys, credentials). Blocking works for tools that honour PreToolUse responses; everything else gets an ignore-file plus a warning.
          </p>
        </div>
        <button
          onClick={() => update({ enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.enabled ? 'bg-blue-500' : 'bg-control-strong'
          }`}
          aria-label='Toggle secret protection'
          title={config.enabled ? 'Secret Protection ON' : 'Secret Protection OFF'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* "Not 100%" transparency notice (analysis §7.4) */}
      <div className='bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-5'>
        <p className='text-sm text-amber-200/90'>
          <span className='font-semibold'>Not a 100% guarantee.</span> Ignore files are best-effort,
          and hooks can’t catch files read through shell commands (we make a conservative attempt).
          For true secrets, use a secret manager or an OS sandbox — this feature reduces exposure and
          warns you, it doesn’t seal the door.
        </p>
      </div>

      {/* Supported agents coverage (analysis §2.1) */}
      <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-5 shadow-xl mb-5'>
        <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>Coverage by agent</p>
        <div className='flex flex-col gap-2'>
          {(Object.keys(COVERAGE) as ToolId[]).map((toolId) => {
            const cov = COVERAGE[toolId];
            const info = detected[toolId];
            const installed = !!info?.installed;
            const hooked = !!info?.hookInstalled;
            const label = TOOL_META[toolId]?.label ?? toolId;
            return (
              <div
                key={toolId}
                className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                  installed ? 'bg-glass/60 border-edge/60' : 'bg-glass/30 border-edge/30 opacity-50'
                }`}
                title={installed ? (hooked ? 'Hook installed' : 'Detected — hook not installed') : 'Not installed'}
              >
                <span className='text-sm text-primary flex-1 truncate'>
                  {label}
                  {!installed && <span className='text-[10px] text-faint ml-2'>not installed</span>}
                </span>
                <Cov ok={cov.ignoreFile && installed} label='ignore-file' />
                <Cov ok={cov.hookBlock && hooked} label='hook-block' />
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${TONE_CLS[cov.tone]}`}>
                  {cov.badge}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Layer toggles + scope */}
      <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-5 shadow-xl mb-5 flex flex-col gap-3'>
        <LayerToggle
          label='Write ignore files'
          hint='Fan the glob list out to each agent’s ignore/deny file (Claude deny, .cursorignore, …).'
          value={config.writeIgnoreFiles}
          onChange={(v) => update({ writeIgnoreFiles: v })}
        />
        <LayerToggle
          label='Active hook blocking'
          hint='Deny a protected read at tool-call time for agents that support it (Claude, Antigravity). Off = audit-only: reads are logged but not refused.'
          value={config.hookBlocking}
          onChange={(v) => update({ hookBlocking: v })}
        />
        <div className='flex items-start justify-between gap-3 pt-1'>
          <div className='min-w-0'>
            <p className='text-sm font-medium text-primary'>Scope</p>
            <p className='text-xs text-muted mt-0.5'>
              Global writes one ignore list per machine; Project writes into each recently-active project folder.
            </p>
          </div>
          <div className='inline-flex gap-1 p-1 rounded-lg bg-glass/60 border border-edge/60 shrink-0'>
            {(['global', 'project'] as const).map((s) => (
              <button
                key={s}
                onClick={() => update({ scope: s })}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer ${
                  config.scope === s ? 'bg-blue-600 text-white' : 'text-muted hover:text-strong'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rule list */}
      <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-5 shadow-xl'>
        <div className='flex items-center justify-between mb-4'>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint'>
            Protected globs ({allRules.length})
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className='px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors'
          >
            + Add glob
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
                    ? 'bg-glass/40 border-edge/40 opacity-50'
                    : 'bg-glass/60 border-edge/60'
                }`}
              >
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2'>
                    <code className='text-xs text-ok font-mono truncate'>{rule.glob}</code>
                    {isCustom && (
                      <span className='text-[10px] text-blue-400 font-medium'>custom</span>
                    )}
                  </div>
                  {rule.message && (
                    <p className='text-sm text-body mt-0.5'>{rule.message}</p>
                  )}
                  <code className='text-[10px] text-faint font-mono break-all'>{rule.id}</code>
                </div>
                <div className='flex flex-col items-end gap-1 shrink-0'>
                  <button
                    onClick={() => toggleRule(rule.id, !isDisabled)}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer ${
                      !isDisabled ? 'bg-blue-500' : 'bg-control-strong'
                    }`}
                    aria-label={isDisabled ? 'Enable glob' : 'Disable glob'}
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
                      className='text-[10px] text-faint hover:text-red-400 cursor-pointer transition-colors'
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
      <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-5 shadow-xl mt-5'>
        <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>
          Recent reads {events.length > 0 && `(${events.length})`}
        </p>
        {events.length === 0 ? (
          <p className='text-sm text-faint italic'>No protected-file reads observed yet.</p>
        ) : (
          <div className='flex flex-col gap-2 max-h-72 overflow-y-auto apple-scroll'>
            {events.map((evt, i) => (
              <div
                key={`${evt.ts}-${i}`}
                className='flex items-start gap-3 p-2.5 rounded-lg bg-glass/60 border border-edge/40'
              >
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                    evt.decision === 'block'
                      ? 'bg-red-500/15 border-red-500/30 text-danger'
                      : 'bg-amber-500/15 border-amber-500/30 text-warn'
                  }`}
                >
                  {evt.decision}
                </span>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 text-[10px] text-faint'>
                    <span>{new Date(evt.ts).toLocaleTimeString()}</span>
                    <span>·</span>
                    <span>{evt.toolId}</span>
                    {evt.viaShell && (<><span>·</span><span className='italic'>shell (best-effort)</span></>)}
                    {!evt.blockable && evt.decision === 'warn' && (
                      <><span>·</span><span className='italic'>blocking not supported</span></>
                    )}
                  </div>
                  <code className='text-xs text-body font-mono break-all'>{evt.filePath}</code>
                  <p className='text-[11px] text-muted mt-0.5'>
                    {evt.matched.map((m) => m.glob).join(', ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddGlobModal
          onClose={() => setShowAdd(false)}
          onSaved={(nextCfg) => { setConfig(nextCfg); setShowAdd(false); }}
        />
      )}
    </div>
  );
};

// ── Coverage pill (ignore-file / hook-block) ────────────────────────────────────

const Cov: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${
      ok ? 'text-ok' : 'text-ghost'
    }`}
    title={`${label}: ${ok ? 'yes' : 'no'}`}
  >
    {ok ? '✓' : '✗'} {label}
  </span>
);

// ── Layer toggle row ──────────────────────────────────────────────────────────

const LayerToggle: React.FC<{
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, hint, value, onChange }) => (
  <div className='flex items-start justify-between gap-3'>
    <div className='min-w-0'>
      <p className='text-sm font-medium text-primary'>{label}</p>
      <p className='text-xs text-muted mt-0.5'>{hint}</p>
    </div>
    <button
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer shrink-0 mt-0.5 ${
        value ? 'bg-blue-500' : 'bg-control-strong'
      }`}
      aria-label={`Toggle ${label}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
);

// ── Add custom glob modal ───────────────────────────────────────────────────────

interface AddGlobModalProps {
  onClose: () => void;
  onSaved: (cfg: SecretProtectionConfig) => void;
}

const AddGlobModal: React.FC<AddGlobModalProps> = ({ onClose, onSaved }) => {
  const [id, setId] = useState('');
  const [glob, setGlob] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    if (!id.trim() || !glob.trim()) {
      setError('id and glob are required');
      return;
    }
    if (!/^[a-z0-9-]+$/i.test(id)) {
      setError('id must be alphanumeric / dash only');
      return;
    }
    setSaving(true);
    try {
      const check = await window.electron.invoke('secret-protection:validate-glob', glob);
      if (!check.ok) {
        setError(check.reason ?? 'invalid glob');
        setSaving(false);
        return;
      }
      const rule: SecretRule = {
        id: id.trim(),
        glob: glob.trim(),
        source: 'user',
        message: message.trim() || undefined,
      };
      const next = await window.electron.invoke('secret-protection:add-custom-rule', rule);
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
        className='apple-scroll relative w-full max-w-lg mx-4 bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>
        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-1'>New glob</p>
          <h2 className='text-lg font-bold text-strong'>Protected file glob</h2>
        </div>

        <Field label='ID'>
          <input
            value={id} onChange={(e) => setId(e.target.value)}
            placeholder='e.g. company-token'
            className={inputCls}
          />
        </Field>

        <Field label='Glob (.gitignore-style)'>
          <input
            value={glob} onChange={(e) => setGlob(e.target.value)}
            placeholder='e.g. **/*.secret  or  config/keys/**'
            className={inputCls + ' font-mono'}
          />
        </Field>

        <Field label='Message (optional)'>
          <input
            value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder='Why this file is sensitive.'
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
            className='px-4 py-2 rounded-lg text-sm font-medium bg-control hover:bg-control-strong text-body cursor-pointer transition-colors'
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors disabled:opacity-50'
          >
            {saving ? 'Saving…' : 'Save glob'}
          </button>
        </div>
      </div>
    </div>
  );
};

const inputCls =
  'w-full bg-glass/60 border border-edge/60 rounded-lg px-3 py-2 text-sm text-strong placeholder:text-faint focus:outline-none focus:border-blue-500/60';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className='text-xs font-semibold uppercase tracking-wider text-faint mb-1.5'>{label}</p>
    {children}
  </div>
);
