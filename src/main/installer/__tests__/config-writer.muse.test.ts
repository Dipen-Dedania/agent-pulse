import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigWriter } from '../config-writer';

// ── Muse Code (Meta) ─────────────────────────────────────────────────────────
// Muse merges our hooks into its user settings file, so these tests focus on
// the merge/backup rules that keep the user's own settings intact and on the
// two things Muse is strict about: `schema_version` and a BOM-free file.
// Payload shapes and the deny contract were captured on Muse 1.4.1 — see
// src/main/bridge/__tests__/fixtures/muse/NOTES.md.

let tmpDir: string;
let savedXdg: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pulse-muse-'));
  // The helper honours XDG_CONFIG_HOME unconditionally; keep the developer's
  // real value out of the fake home.
  savedXdg = process.env['XDG_CONFIG_HOME'];
  delete process.env['XDG_CONFIG_HOME'];
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env['XDG_CONFIG_HOME'];
  else process.env['XDG_CONFIG_HOME'] = savedXdg;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function withFakeHome(fn: (writer: ConfigWriter) => Promise<void>) {
  vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  try {
    await fn(new ConfigWriter());
  } finally {
    vi.restoreAllMocks();
  }
}

const settingsPath = () => path.join(tmpDir, '.config', 'muse', 'settings.json');
const shPath = () => path.join(tmpDir, '.config', 'muse', 'hooks', 'agent-pulse.sh');
const ps1Path = () => path.join(tmpDir, '.config', 'muse', 'hooks', 'agent-pulse.ps1');
const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SessionEnd',
];

const isOurs = (h: any) => h?.statusMessage === 'Agent Pulse';

describe('ConfigWriter — muse-code', () => {
  it('creates ~/.config/muse/settings.json with schema_version 1, command hooks and the script pair', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('muse-code');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('muse-code')).toBe(true);

      const settings = readSettings();
      expect(settings.schema_version).toBe(1);
      for (const event of EVENTS) {
        expect(settings.hooks[event], event).toBeDefined();
        expect(settings.hooks[event]).toHaveLength(1);
        const hook = settings.hooks[event][0].hooks[0];
        expect(hook.type).toBe('command');
        expect(hook.command).toContain('agent-pulse.sh');
        expect(hook.commandWindows).toContain('-EncodedCommand');
        expect(hook.timeout).toBe(10);
        expect(hook.statusMessage).toBe('Agent Pulse');
        // Only the deny-capable PreToolUse hook and the once-per-session
        // SessionStart are awaited; everything else is background observation
        // so it never stalls a turn.
        if (event === 'PreToolUse' || event === 'SessionStart') expect(hook.async, event).toBeUndefined();
        else expect(hook.async, event).toBe(true);
      }
      // Muse's per-LLM-call and reminder-subagent events are deliberately NOT
      // registered (huge payloads / noise on every turn).
      expect(settings.hooks.PostLLMCall).toBeUndefined();
      expect(settings.hooks.PreLLMCall).toBeUndefined();
      expect(settings.hooks.SubagentStart).toBeUndefined();
      expect(settings.hooks.SubagentStop).toBeUndefined();

      expect(fs.existsSync(shPath())).toBe(true);
      expect(fs.existsSync(ps1Path())).toBe(true);
      const sh = fs.readFileSync(shPath(), 'utf8');
      const ps1 = fs.readFileSync(ps1Path(), 'utf8');
      expect(sh).toContain('"_ap_tool":"muse-code"');
      expect(ps1).toContain('"_ap_tool":"muse-code"');
      // Muse rejects "status":"blocked"; the scripts key on the Claude field.
      expect(sh).toContain('"permissionDecision":"deny"');
      expect(ps1).toContain('"permissionDecision":"deny"');
      expect(sh).not.toContain('"status":"blocked"');
      expect(ps1).not.toContain('"status":"blocked"');
      // Only the once-per-session SessionStart walks the process tree; every
      // other hook (the awaited PreToolUse included) stays on the fast path.
      expect(ps1).toContain('"hook_event_name"\\s*:\\s*"SessionStart"');
      expect(ps1).toContain('Get-CimInstance');
      expect(ps1).not.toContain('ConvertTo-Json');
      expect(ps1).not.toContain('Invoke-WebRequest');
      // Literal IPv4 loopback: a `localhost` URL costs ~2s per hook in .NET
      // (IPv6 attempt against the IPv4-only bridge).
      expect(ps1).toContain('http://127.0.0.1:4242/event');
      expect(sh).toContain('http://127.0.0.1:4242/event');
      expect(ps1).not.toContain('localhost:4242');
      expect(sh).not.toContain('localhost:4242');
    });
  });

  it('writes the settings file without a UTF-8 BOM', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      const bytes = fs.readFileSync(settingsPath());
      expect(bytes[0]).toBe('{'.charCodeAt(0));
    });
  });

  it('encodes the PowerShell launcher so the Windows command carries no double quotes', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      const hook = readSettings().hooks.PreToolUse[0].hooks[0];
      // cmd.exe receives embedded quotes backslash-escaped and chokes on them,
      // so the whole Windows form must be quote-free.
      expect(hook.commandWindows).not.toContain('"');
      const b64 = hook.commandWindows.split('-EncodedCommand ')[1];
      const decoded = Buffer.from(b64, 'base64').toString('utf16le');
      expect(decoded).toBe(`& '${ps1Path()}'`);
    });
  });

  it('preserves foreign settings and foreign hooks on install', async () => {
    await withFakeHome(async (writer) => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify({
        schema_version: 1,
        model: 'muse-spark-1.2',
        tui: { theme: 'dark' },
        hooks: {
          PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: '/home/me/lint.sh' }] }],
          PostCompact: [{ hooks: [{ type: 'command', command: '/home/me/compact.sh' }] }],
        },
      }));

      await writer.installHook('muse-code');
      const settings = readSettings();
      expect(settings.model).toBe('muse-spark-1.2');
      expect(settings.tui).toEqual({ theme: 'dark' });
      // Foreign group first, ours appended as a separate group.
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('/home/me/lint.sh');
      expect(isOurs(settings.hooks.PreToolUse[1].hooks[0])).toBe(true);
      // An event we don't register is untouched.
      expect(settings.hooks.PostCompact[0].hooks[0].command).toBe('/home/me/compact.sh');
    });
  });

  it('is idempotent on re-install (one Agent Pulse group per event)', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      await writer.installHook('muse-code');
      const settings = readSettings();
      for (const event of EVENTS) {
        const ours = settings.hooks[event].filter((g: any) => g.hooks.some(isOurs));
        expect(ours, event).toHaveLength(1);
      }
      expect(writer.isHookInstalled('muse-code')).toBe(true);
    });
  });

  it('adds schema_version when an existing file lacks it', async () => {
    await withFakeHome(async (writer) => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify({ hooks: {} }));
      await writer.installHook('muse-code');
      expect(readSettings().schema_version).toBe(1);
    });
  });

  it('strips a UTF-8 BOM on read and does not write one back', async () => {
    await withFakeHome(async (writer) => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), '﻿' + JSON.stringify({ schema_version: 1, model: 'keep-me' }));
      await writer.installHook('muse-code');
      const bytes = fs.readFileSync(settingsPath());
      expect(bytes[0]).toBe('{'.charCodeAt(0));
      expect(readSettings().model).toBe('keep-me');
    });
  });

  it('refuses to touch an unparsable settings file', async () => {
    await withFakeHome(async (writer) => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), '{ this is not json');
      await expect(writer.installHook('muse-code')).rejects.toThrow(/not valid JSON/);
      expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ this is not json');
      expect(fs.existsSync(shPath())).toBe(false);
      expect(writer.isHookInstalled('muse-code')).toBe(false);
    });
  });

  it('uninstall removes only Agent Pulse entries and the scripts', async () => {
    await withFakeHome(async (writer) => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify({
        schema_version: 1,
        model: 'muse-spark-1.2',
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: '/home/me/lint.sh' }] }],
        },
      }));
      await writer.installHook('muse-code');
      expect(writer.isHookInstalled('muse-code')).toBe(true);

      writer.uninstallHook('muse-code');
      expect(writer.isHookInstalled('muse-code')).toBe(false);
      const settings = readSettings();
      expect(settings.schema_version).toBe(1);
      expect(settings.model).toBe('muse-spark-1.2');
      expect(settings.hooks.PreToolUse).toEqual([{ hooks: [{ type: 'command', command: '/home/me/lint.sh' }] }]);
      for (const event of EVENTS.filter((e) => e !== 'PreToolUse')) {
        expect(settings.hooks[event], event).toBeUndefined();
      }
      expect(fs.existsSync(shPath())).toBe(false);
      expect(fs.existsSync(ps1Path())).toBe(false);
    });
  });

  it('uninstall drops an empty hooks object but keeps the file', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      writer.uninstallHook('muse-code');
      const settings = readSettings();
      expect(settings.hooks).toBeUndefined();
      expect(settings.schema_version).toBe(1);
    });
  });

  it('uninstall leaves an unparsable settings file alone but still removes the scripts', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      fs.writeFileSync(settingsPath(), '{ broken');
      writer.uninstallHook('muse-code');
      expect(fs.readFileSync(settingsPath(), 'utf8')).toBe('{ broken');
      expect(fs.existsSync(shPath())).toBe(false);
    });
  });

  it('is not installed when the scripts are missing even if the settings entries exist', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('muse-code');
      fs.unlinkSync(shPath());
      expect(writer.isHookInstalled('muse-code')).toBe(false);
    });
  });

  it('honours XDG_CONFIG_HOME for the settings and script locations', async () => {
    await withFakeHome(async (writer) => {
      const xdg = path.join(tmpDir, 'xdg');
      process.env['XDG_CONFIG_HOME'] = xdg;
      await writer.installHook('muse-code');
      expect(fs.existsSync(path.join(xdg, 'muse', 'settings.json'))).toBe(true);
      expect(fs.existsSync(path.join(xdg, 'muse', 'hooks', 'agent-pulse.sh'))).toBe(true);
      expect(fs.existsSync(settingsPath())).toBe(false);
      expect(writer.isHookInstalled('muse-code')).toBe(true);
    });
  });
});
