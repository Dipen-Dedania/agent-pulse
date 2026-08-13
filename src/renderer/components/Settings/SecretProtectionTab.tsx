import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { SecretProtectionConfig, SecretRule, SecretAccessEvent } from '../../../common/secretProtection';
import { Badge, Button, GlassToggle, Input, Segmented, Modal, appConfirm, Tooltip, type BadgeTone } from '../Shared';
import { Field, RuleRow, TabLoading } from './settingsShared';
import { ToolId } from '../../../common/types';
import { TOOL_META } from '../../../common/toolMeta';
import { logger } from '../../../common/logger';

// Static per-agent coverage map (analysis §2.1 / §7.4). `installed`/`hooked`
// come from live detection; this table describes what protection each agent can
// receive and how strong it is.
type CoverageTone = 'hard' | 'soft' | 'bypass' | 'none';
const COVERAGE: Record<ToolId, { ignoreFile: boolean; hookBlock: boolean; badge: string; tone: CoverageTone }> = {
  'claude-code':     { ignoreFile: true,  hookBlock: true,  badge: 'Hook deny (soft)',        tone: 'soft' },
  'antigravity-cli': { ignoreFile: true,  hookBlock: true,  badge: 'Hook deny + built-in',    tone: 'soft' },
  'cursor':          { ignoreFile: true,  hookBlock: false, badge: 'Bypassable in agent mode',tone: 'bypass' },
  'vscode-copilot':  { ignoreFile: true,  hookBlock: false, badge: 'Not applied in agent mode',tone: 'bypass' },
  'openai-codex':    { ignoreFile: true,  hookBlock: false, badge: 'Sandbox (built-in)',      tone: 'hard' },
  'kiro':            { ignoreFile: false, hookBlock: false, badge: 'Unsupported',             tone: 'none' },
  // Grok: no Agent Pulse ignore-file writer yet; blocking rides the native HTTP
  // PreToolUse deny (Claude-compatible response shape).
  'grok':            { ignoreFile: false, hookBlock: true,  badge: 'Hook deny (soft)',        tone: 'soft' },
  // OpenCode: our plugin currently fires and forgets, so nothing round-trips a
  // deny verdict yet. It CAN block (the permission.ask hook accepts
  // status:"deny"), which is why this is 'none' rather than a hard limitation.
  'opencode':        { ignoreFile: false, hookBlock: false, badge: 'Monitor only',            tone: 'none' },
};

// How strong a tool's protection is, mapped onto the shared Badge palette.
const TONE_BADGE: Record<CoverageTone, BadgeTone> = {
  hard:   'ok',
  soft:   'warn',
  bypass: 'danger',
  none:   'neutral',
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
    const ok = await appConfirm({
      title: 'Delete this protected glob?',
      message: `“${ruleId}” will be removed permanently. Core rules can be turned off instead of deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const next = await window.electron.invoke('secret-protection:remove-custom-rule', ruleId);
    setConfig(next);
  };

  const allRules: SecretRule[] = useMemo(() => {
    if (!config) return coreRules;
    return [...coreRules, ...config.customRules];
  }, [coreRules, config]);

  if (!config) {
    return <TabLoading label='Loading secret protection…' />;
  }

  return (
    <div>
      <div className='flex items-center justify-between mb-5'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Secret Protection</h2>
          <p className='text-sm text-muted mt-1'>
            Stop agents from reading secret files (.env, keys, credentials). Some agents can deny the read
            outright; others get an ignore-file plus a warning.
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

      <div className={config.enabled ? '' : 'opacity-60'}>
        {/* Supported agents coverage (analysis §2.1) */}
        <div className='glass-primary p-5 mb-5'>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>Coverage by agent</p>
          <div className='flex flex-col gap-2'>
            {(Object.keys(COVERAGE) as ToolId[]).map((toolId) => {
              const cov = COVERAGE[toolId];
              const info = detected[toolId];
              const installed = !!info?.installed;
              const hooked = !!info?.hookInstalled;
              const label = TOOL_META[toolId]?.label ?? toolId;
              const icon = TOOL_META[toolId]?.icon;
              return (
                <Tooltip key={toolId} content={installed ? (hooked ? 'Hook installed' : 'Detected — hook not installed') : 'Not installed'}>
                  <div
                    className={`glass-secondary flex items-center gap-3 p-2.5 ${
                      installed ? '' : 'opacity-50'
                    }`}
                  >
                    {icon && (
                      <img src={icon} alt='' className='w-5 h-5 object-contain shrink-0' />
                    )}
                    <span className='text-sm text-primary flex-1 truncate'>
                      {label}
                      {!installed && <span className='text-[10px] text-faint ml-2'>not installed</span>}
                    </span>
                    <Cov ok={cov.ignoreFile && installed} label='ignore-file' />
                    <Cov ok={cov.hookBlock && hooked} label='hook-block' />
                    <Badge
                      tone={TONE_BADGE[cov.tone]}
                      variant='pill'
                      size='xs'
                      weight='semibold'
                      className='shrink-0'
                    >
                      {cov.badge}
                    </Badge>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Layer toggles + scope */}
        <div className='glass-primary p-5 mb-5 flex flex-col gap-3'>
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
            <Segmented
              options={[{ value: 'global', label: 'Global' }, { value: 'project', label: 'Project' }]}
              value={config.scope}
              onChange={(v) => update({ scope: v as SecretProtectionConfig['scope'] })}
            />
          </div>
        </div>

        {/* Rule list */}
        <div className='glass-primary p-5'>
          <div className='flex items-center justify-between mb-4'>
            <p className='text-xs font-semibold uppercase tracking-widest text-faint'>
              Protected globs ({allRules.length})
            </p>
            <Button onClick={() => setShowAdd(true)} variant='primary' size='sm'>
              + Add glob
            </Button>
          </div>

          <div className='flex flex-col gap-2'>
            {allRules.map((rule) => (
              <RuleRow
                key={rule.id}
                title={<code className='text-xs text-ok font-mono truncate'>{rule.glob}</code>}
                isCustom={rule.source === 'user'}
                message={rule.message}
                subtext={<code className='text-[10px] text-muted font-mono break-all'>{rule.id}</code>}
                enabled={!config.disabledRuleIds.includes(rule.id)}
                onToggle={() => toggleRule(rule.id, !config.disabledRuleIds.includes(rule.id))}
                toggleLabel={config.disabledRuleIds.includes(rule.id) ? 'Enable glob' : 'Disable glob'}
                onDelete={rule.source === 'user' ? () => removeCustomRule(rule.id) : undefined}
              />
            ))}
          </div>
        </div>

        {/* Recent events */}
        <div className='glass-primary p-5 mt-5'>
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
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddGlobModal
            onClose={() => setShowAdd(false)}
            onSaved={(nextCfg) => { setConfig(nextCfg); setShowAdd(false); }}
          />
        )}
      </AnimatePresence>
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
    <Modal
      eyebrow='New glob'
      title='Protected file glob'
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} variant='secondary' size='md'>Cancel</Button>
          <Button onClick={save} disabled={saving} variant='primary' size='md'>
            {saving ? 'Saving…' : 'Save glob'}
          </Button>
        </>
      }
    >
      <Field label='ID'>
        <Input
          value={id} onChange={(e) => setId(e.target.value)}
          placeholder='e.g. company-token'
          className='w-full'
        />
      </Field>

      <Field label='Glob (.gitignore-style)'>
        <Input
          value={glob} onChange={(e) => setGlob(e.target.value)}
          placeholder='e.g. **/*.secret  or  config/keys/**'
          className='w-full font-mono'
        />
      </Field>

      <Field label='Message (optional)'>
        <Input
          value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder='Why this file is sensitive.'
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
