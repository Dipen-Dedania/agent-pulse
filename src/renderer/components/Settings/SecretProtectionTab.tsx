import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SecretProtectionConfig, SecretRule, SecretAccessEvent } from '../../../common/secretProtection';
import { Button, GlassToggle, Tooltip } from '../Shared';
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
  bypass: 'bg-rose-500/15 border-rose-500/30 text-danger',
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
        <GlassToggle
          checked={config.enabled}
          onChange={() => update({ enabled: !config.enabled })}
          size='lg'
          label='Toggle secret protection'
        />
      </div>

      {/* "Not 100%" transparency notice (analysis §7.4) */}
      <div className='bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-5'>
        <p className='text-sm text-warn/90'>
          <span className='font-semibold'>Not a 100% guarantee.</span> Ignore files are best-effort,
          and hooks can’t catch files read through shell commands (we make a conservative attempt).
          For true secrets, use a secret manager or an OS sandbox — this feature reduces exposure and
          warns you, it doesn’t seal the door.
        </p>
      </div>

      {/* Supported agents coverage (analysis §2.1) */}
      <motion.div
        whileHover={{ scale: 1.003 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className='glass-primary p-5 mb-5'
      >
        <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>Coverage by agent</p>
        <div className='flex flex-col gap-2'>
          {(Object.keys(COVERAGE) as ToolId[]).map((toolId) => {
            const cov = COVERAGE[toolId];
            const info = detected[toolId];
            const installed = !!info?.installed;
            const hooked = !!info?.hookInstalled;
            const label = TOOL_META[toolId]?.label ?? toolId;
            return (
              <Tooltip key={toolId} content={installed ? (hooked ? 'Hook installed' : 'Detected — hook not installed') : 'Not installed'}>
                <div
                  className={`glass-secondary flex items-center gap-3 p-2.5 ${
                    installed ? '' : 'opacity-50'
                  }`}
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
              </Tooltip>
            );
          })}
        </div>
      </motion.div>

      {/* Layer toggles + scope */}
      <motion.div
        whileHover={{ scale: 1.003 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className='glass-primary p-5 mb-5 flex flex-col gap-3'
      >
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
          <div className='glass-secondary rounded-lg inline-flex gap-1 p-1 shrink-0'>
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
      </motion.div>

      {/* Rule list */}
      <motion.div
        whileHover={{ scale: 1.003 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className='glass-primary p-5'
      >
        <div className='flex items-center justify-between mb-4'>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint'>
            Protected globs ({allRules.length})
          </p>
          <Button
            onClick={() => setShowAdd(true)}
            variant='primary'
            size='sm'
          >
            + Add glob
          </Button>
        </div>

        <div className='flex flex-col gap-2'>
          {allRules.map((rule) => {
            const isDisabled = config.disabledRuleIds.includes(rule.id);
            const isCustom = rule.source === 'user';
            return (
              <div
                key={rule.id}
                className={`glass-secondary flex items-start gap-3 p-3 ${
                  isDisabled ? 'opacity-50' : ''
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
                  <GlassToggle
                    checked={!isDisabled}
                    onChange={() => toggleRule(rule.id, !isDisabled)}
                    size='sm'
                    label={isDisabled ? 'Enable glob' : 'Disable glob'}
                  />
                  {isCustom && (
                    <button
                      onClick={() => removeCustomRule(rule.id)}
                      className='text-[10px] text-faint hover:text-danger cursor-pointer transition-colors'
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Recent events */}
      <motion.div
        whileHover={{ scale: 1.003 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className='glass-primary p-5 mt-5'
      >
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
                className='glass-secondary rounded-lg flex items-start gap-3 p-2.5'
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
      </motion.div>

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
  <Tooltip content={`${label}: ${ok ? 'yes' : 'no'}`}>
    <span
      className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${
        ok ? 'text-ok' : 'text-ghost'
      }`}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  </Tooltip>
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
    <GlassToggle
      checked={value}
      onChange={() => onChange(!value)}
      size='sm'
      label={`Toggle ${label}`}
    />
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
        className='glass-modal apple-scroll w-full max-w-lg mx-4 p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
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
          <Button
            onClick={onClose}
            variant='secondary'
            size='md'
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            variant='primary'
            size='md'
          >
            {saving ? 'Saving…' : 'Save glob'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const inputCls =
  'glass-secondary rounded-lg w-full px-3 py-2 text-sm text-strong placeholder:text-faint focus:outline-none focus:border-blue-500/60';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className='text-xs font-semibold uppercase tracking-wider text-faint mb-1.5'>{label}</p>
    {children}
  </div>
);
