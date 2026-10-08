import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigWriter } from '../config-writer';
import { ToolDetector } from '../detector';
import { renderStatusLine } from '../../../common/statusline-render';
import { StatusLineConfig } from '../../../common/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pulse-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Patch os.homedir to return our tmpDir so we don't touch the real home
async function withFakeHome(fn: (writer: ConfigWriter) => Promise<void>) {
  vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  try {
    await fn(new ConfigWriter());
  } finally {
    vi.restoreAllMocks();
  }
}

// ── Claude Code ───────────────────────────────────────────────────────────────

describe('ConfigWriter — claude-code', () => {
  it('creates ~/.claude/settings.json with http hooks', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('claude-code');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('claude-code')).toBe(true);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
      expect(settings.hooks.StopFailure).toBeDefined();
      expect(settings.hooks.PermissionRequest).toBeDefined();
      expect(settings.hooks.Elicitation).toBeDefined();
      const hook = settings.hooks.PreToolUse[0].hooks[0];
      expect(hook.type).toBe('http');
      expect(hook.url).toBe('http://localhost:4242/event');
    });
  });

  it('uninstall removes the hook keys from settings.json', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('claude-code');
      writer.uninstallHook('claude-code');

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeUndefined();
      expect(writer.isHookInstalled('claude-code')).toBe(false);
    });
  });

  it('recognizes legacy installs with the core Claude Code hooks', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const httpHook = { type: 'http', url: 'http://localhost:4242/event', timeout: 5 };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: '*', hooks: [httpHook] }],
            Stop: [{ hooks: [httpHook] }],
            StopFailure: [{ hooks: [httpHook] }],
          },
        }, null, 2),
      );

      expect(writer.isHookInstalled('claude-code')).toBe(true);
    });
  });

  it('registers all 11 Claude Code lifecycle events', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('claude-code');
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const events = Object.keys(settings.hooks);
      expect(events).toEqual(expect.arrayContaining([
        'PreToolUse', 'PermissionRequest', 'Elicitation', 'Notification',
        'Stop', 'StopFailure', 'SessionStart', 'SessionEnd',
        'UserPromptSubmit', 'SubagentStart', 'SubagentStop',
      ]));
      expect(events).toHaveLength(11);
      // Matcher events carry matcher '*'; lifecycle events don't.
      expect(settings.hooks.Notification[0].matcher).toBe('*');
      expect(settings.hooks.SessionStart[0].matcher).toBeUndefined();
    });
  });

  it('claudeCodeHookNeedsUpgrade: legacy → true, full → false, foreign/none → false', async () => {
    await withFakeHome(async (writer) => {
      // No settings.json at all.
      expect(writer.claudeCodeHookNeedsUpgrade()).toBe(false);

      // Legacy 3-event install: ours, but stale.
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const httpHook = { type: 'http', url: 'http://localhost:4242/event', timeout: 5 };
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [httpHook] }],
          Stop: [{ hooks: [httpHook] }],
          StopFailure: [{ hooks: [httpHook] }],
        },
      }, null, 2));
      expect(writer.claudeCodeHookNeedsUpgrade()).toBe(true);

      // Upgrade brings it to the full set and clears the flag.
      expect(writer.upgradeClaudeCodeHook().success).toBe(true);
      expect(writer.claudeCodeHookNeedsUpgrade()).toBe(false);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(Object.keys(settings.hooks)).toHaveLength(11);

      // Foreign hooks (someone else's command hook) are never "upgradable".
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'my-tool' }] }] },
      }, null, 2));
      expect(writer.claudeCodeHookNeedsUpgrade()).toBe(false);
    });
  });

  it('upgrade preserves foreign hook keys and unrelated settings', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const httpHook = { type: 'http', url: 'http://localhost:4242/event', timeout: 5 };
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [httpHook] }],
          Stop: [{ hooks: [httpHook] }],
          StopFailure: [{ hooks: [httpHook] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'user-audit.sh' }] }],
        },
      }, null, 2));

      writer.upgradeClaudeCodeHook();
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.model).toBe('opus');
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('user-audit.sh');
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.SubagentStop).toBeDefined();
    });
  });

  it('install preserves a user hook under one of our own event keys', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settingsPath = path.join(claudeDir, 'settings.json');
      const userEntry = { hooks: [{ type: 'command', command: 'log-stop.sh' }] };
      fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { Stop: [userEntry] } }, null, 2));

      await writer.installHook('claude-code');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.Stop).toHaveLength(2);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe('log-stop.sh');
      expect(settings.hooks.Stop[1].hooks[0].url).toBe('http://localhost:4242/event');
    });
  });

  it('repeated install/upgrade is idempotent and keeps foreign entries', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settingsPath = path.join(claudeDir, 'settings.json');
      const userEntry = { hooks: [{ type: 'command', command: 'log-stop.sh' }] };
      fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { Stop: [userEntry] } }, null, 2));

      await writer.installHook('claude-code');
      writer.upgradeClaudeCodeHook();
      writer.upgradeClaudeCodeHook();
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const ours = settings.hooks.Stop.filter((e: any) =>
        e.hooks?.some((h: any) => h.type === 'http' && h.url === 'http://localhost:4242/event'));
      expect(ours).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe('log-stop.sh');
      expect(settings.hooks.Stop).toHaveLength(2);
    });
  });

  it('install cleans legacy entries written under a different bridge port', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://localhost:5151/event', timeout: 5 }] }] },
      }, null, 2));

      await writer.installHook('claude-code');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].url).toBe('http://localhost:4242/event');
    });
  });

  it('install keeps a user hook that was hand-added inside our old entry', async () => {
    await withFakeHome(async (writer) => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          Stop: [{
            hooks: [
              { type: 'http', url: 'http://localhost:4242/event', timeout: 5 },
              { type: 'command', command: 'user.sh' },
            ],
          }],
        },
      }, null, 2));

      await writer.installHook('claude-code');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const commands = settings.hooks.Stop.flatMap((e: any) => e.hooks ?? [])
        .filter((h: any) => h.type === 'command').map((h: any) => h.command);
      expect(commands).toEqual(['user.sh']);
      const urls = settings.hooks.Stop.flatMap((e: any) => e.hooks ?? [])
        .filter((h: any) => h.type === 'http').map((h: any) => h.url);
      expect(urls).toEqual(['http://localhost:4242/event']);
    });
  });

  it('uninstall preserves user hooks under our keys and foreign-only keys', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('claude-code');
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings.hooks.PreToolUse.unshift({ matcher: '*', hooks: [{ type: 'command', command: 'lint.sh' }] });
      settings.hooks.PostToolUse = [{ hooks: [{ type: 'command', command: 'audit.sh' }] }];
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      writer.uninstallHook('claude-code');
      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(after.hooks.PreToolUse).toHaveLength(1);
      expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('lint.sh');
      expect(after.hooks.PostToolUse[0].hooks[0].command).toBe('audit.sh');
      expect(after.hooks.Stop).toBeUndefined();
      expect(writer.isHookInstalled('claude-code')).toBe(false);
    });
  });
});

// ── Cursor ────────────────────────────────────────────────────────────────────

describe('ConfigWriter — cursor', () => {
  it('creates hooks.json and script files under projectPath', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    const result = await writer.installHook('cursor', projectPath);
    expect(result.success).toBe(true);

    const hooksJson = path.join(projectPath, '.cursor', 'hooks.json');
    expect(fs.existsSync(hooksJson)).toBe(true);
    const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    expect(config.hooks.preToolUse).toBeDefined();
    expect(config.hooks.sessionStart).toBeDefined();

    // Scripts exist
    const shPath = path.join(projectPath, '.cursor', 'hooks', 'agent-pulse.sh');
    expect(fs.existsSync(shPath)).toBe(true);
  });

  it('uninstall removes hook entries and scripts', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('cursor', projectPath);
    expect(writer.isHookInstalled('cursor', projectPath)).toBe(true);
    writer.uninstallHook('cursor', projectPath);

    const shPath = path.join(projectPath, '.cursor', 'hooks', 'agent-pulse.sh');
    expect(fs.existsSync(shPath)).toBe(false);
    expect(writer.isHookInstalled('cursor', projectPath)).toBe(false);

    const hooksJson = path.join(projectPath, '.cursor', 'hooks.json');
    const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    // hooks key is removed entirely when all events are deleted
    expect(config.hooks).toBeUndefined();
  });

  it('uninstall preserves foreign cursor hook entries', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('cursor', projectPath);

    const hooksJson = path.join(projectPath, '.cursor', 'hooks.json');
    const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    config.hooks.preToolUse.unshift({ command: 'my-linter.sh', timeout: 5 });
    fs.writeFileSync(hooksJson, JSON.stringify(config, null, 2));

    writer.uninstallHook('cursor', projectPath);
    const after = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    expect(after.hooks.preToolUse).toHaveLength(1);
    expect(after.hooks.preToolUse[0].command).toBe('my-linter.sh');
    expect(after.hooks.sessionStart).toBeUndefined();
    expect(writer.isHookInstalled('cursor', projectPath)).toBe(false);
  });

  it('does not treat a bare hooks.json as an installed hook', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const cursorDir = path.join(projectPath, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'hooks.json'), JSON.stringify({ version: 1 }, null, 2));

    const writer = new ConfigWriter();
    expect(writer.isHookInstalled('cursor', projectPath)).toBe(false);
  });
});

// ── VS Code Copilot ───────────────────────────────────────────────────────────

describe('ConfigWriter — vscode-copilot', () => {
  it('creates agent-pulse-hooks.json under .github/hooks', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    const result = await writer.installHook('vscode-copilot', projectPath);
    expect(result.success).toBe(true);
    expect(writer.isHookInstalled('vscode-copilot', projectPath)).toBe(true);

    const hookFile = path.join(projectPath, '.github', 'hooks', 'agent-pulse-hooks.json');
    expect(fs.existsSync(hookFile)).toBe(true);
    const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
    expect(config.hooks.PreToolUse).toBeDefined();
    expect(config.hooks.Stop).toBeDefined();
  });

  it('registers all 8 Copilot lifecycle events', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('vscode-copilot', projectPath);

    const hookFile = path.join(projectPath, '.github', 'hooks', 'agent-pulse-hooks.json');
    const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
    const events = Object.keys(config.hooks);
    expect(events).toEqual(expect.arrayContaining([
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
      'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop',
    ]));
    expect(events).toHaveLength(8);
  });

  it('includes both command (unix) and windows properties for cross-platform support', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('vscode-copilot', projectPath);

    const hookFile = path.join(projectPath, '.github', 'hooks', 'agent-pulse-hooks.json');
    const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
    const hook = config.hooks.PreToolUse[0];
    expect(hook.type).toBe('command');
    expect(hook.command).toMatch(/agent-pulse\.sh/);
    expect(hook.windows).toMatch(/agent-pulse\.ps1/);
  });

  it('hook scripts exit 0 on success', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('vscode-copilot', projectPath);

    const shPath = path.join(projectPath, '.github', 'hooks', 'agent-pulse.sh');
    const shContent = fs.readFileSync(shPath, 'utf8');
    expect(shContent).toContain('exit 0');

    const ps1Path = path.join(projectPath, '.github', 'hooks', 'agent-pulse.ps1');
    const ps1Content = fs.readFileSync(ps1Path, 'utf8');
    expect(ps1Content).toContain('exit 0');
  });

  it('uninstall removes hook file and scripts', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('vscode-copilot', projectPath);
    writer.uninstallHook('vscode-copilot', projectPath);

    const hookFile = path.join(projectPath, '.github', 'hooks', 'agent-pulse-hooks.json');
    expect(fs.existsSync(hookFile)).toBe(false);
    expect(writer.isHookInstalled('vscode-copilot', projectPath)).toBe(false);
  });
});

// ── OpenAI Codex ──────────────────────────────────────────────────────────────

describe('ConfigWriter — openai-codex', () => {
  it('creates hooks.json and enables the hooks flag in config.toml', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('openai-codex');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('openai-codex')).toBe(true);

      const hooksJson = path.join(tmpDir, '.codex', 'hooks.json');
      expect(fs.existsSync(hooksJson)).toBe(true);
      const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
      expect(config.hooks.PreToolUse).toBeDefined();

      const toml = fs.readFileSync(path.join(tmpDir, '.codex', 'config.toml'), 'utf8');
      expect(toml).toContain('[features]');
      expect(toml).toMatch(/^hooks = true$/m);
      expect(toml).not.toContain('codex_hooks');
    });
  });

  it('migrates deprecated codex_hooks key to hooks on install', async () => {
    await withFakeHome(async (writer) => {
      const codexDir = path.join(tmpDir, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'config.toml'),
        'model = "gpt-5"\n\n[features]\ncodex_hooks = false\n',
      );

      await writer.installHook('openai-codex');

      const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
      expect(toml).toMatch(/^hooks = true$/m);
      expect(toml).not.toContain('codex_hooks');
      expect(toml).toContain('model = "gpt-5"');
      // Only one [features] table — duplicates are invalid TOML
      expect(toml.match(/^\[features\]$/gm)).toHaveLength(1);
    });
  });

  it('adds hooks flag to an existing [features] section without duplicating it', async () => {
    await withFakeHome(async (writer) => {
      const codexDir = path.join(tmpDir, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'config.toml'),
        '[features]\nweb_search = true\n',
      );

      await writer.installHook('openai-codex');

      const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
      expect(toml).toMatch(/^hooks = true$/m);
      expect(toml).toContain('web_search = true');
      expect(toml.match(/^\[features\]$/gm)).toHaveLength(1);
    });
  });

  it('detects install with legacy codex_hooks flag still present', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('openai-codex');
      // Simulate a config written by an older Agent Pulse version
      const tomlPath = path.join(tmpDir, '.codex', 'config.toml');
      fs.writeFileSync(tomlPath, '[features]\ncodex_hooks = true\n');
      expect(writer.isHookInstalled('openai-codex')).toBe(true);
    });
  });

  it('uninstall removes hook entries and script', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('openai-codex');
      writer.uninstallHook('openai-codex');

      const hooksJson = path.join(tmpDir, '.codex', 'hooks.json');
      const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
      // hooks key is removed entirely when all events are deleted
      expect(config.hooks).toBeUndefined();

      const shPath = path.join(tmpDir, '.codex', 'hooks', 'agent-pulse.sh');
      expect(fs.existsSync(shPath)).toBe(false);
      expect(writer.isHookInstalled('openai-codex')).toBe(false);
    });
  });

  it('hook scripts capture the response and relay a guardrail deny (fail-open)', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('openai-codex');
      const sh = fs.readFileSync(path.join(tmpDir, '.codex', 'hooks', 'agent-pulse.sh'), 'utf8');
      const ps1 = fs.readFileSync(path.join(tmpDir, '.codex', 'hooks', 'agent-pulse.ps1'), 'utf8');

      // bash: response is captured (not discarded) with a timeout, and the
      // block marker is relayed to stdout.
      expect(sh).not.toContain('-o /dev/null');
      expect(sh).toContain('RESP=$(curl');
      expect(sh).toContain('--max-time 3');
      expect(sh).toContain('"status":"blocked"');
      expect(sh).toContain('printf \'%s\' "$RESP"');

      // PowerShell: timeout + marker check + writes the deny body to stdout.
      expect(ps1).toContain('-TimeoutSec 3');
      expect(ps1).toContain('"status":"blocked"');
      expect(ps1).toContain('[Console]::Out.Write($resp.Content)');
    });
  });
});

// ── Kiro ──────────────────────────────────────────────────────────────────────

describe('ConfigWriter — kiro', () => {
  it('creates agent-pulse.kiro.hook under .kiro/hooks in projectPath', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    const result = await writer.installHook('kiro', projectPath);
    expect(result.success).toBe(true);
    expect(writer.isHookInstalled('kiro', projectPath)).toBe(true);

    const hookFile = path.join(projectPath, '.kiro', 'hooks', 'agent-pulse.kiro.hook');
    expect(fs.existsSync(hookFile)).toBe(true);

    const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
    expect(config.hooks.agentSpawn).toBeDefined();
    expect(config.hooks.userPromptSubmit).toBeDefined();
    expect(config.hooks.preToolUse).toBeDefined();
    expect(config.hooks.postToolUse).toBeDefined();
  });

  it('creates hook script files alongside the hook config', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('kiro', projectPath);

    const scriptsDir = path.join(projectPath, '.kiro', 'hooks-scripts');
    expect(fs.existsSync(path.join(scriptsDir, 'agent-pulse.sh'))).toBe(true);
    expect(fs.existsSync(path.join(scriptsDir, 'agent-pulse.ps1'))).toBe(true);
  });

  it('hook command points to the correct script path', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('kiro', projectPath);

    const hookFile = path.join(projectPath, '.kiro', 'hooks', 'agent-pulse.kiro.hook');
    const config = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
    const cmd: string = config.hooks.agentSpawn[0].command;
    expect(cmd).toMatch(/agent-pulse\.(sh|ps1)/);
  });

  it('uninstall removes hook file and scripts', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    await writer.installHook('kiro', projectPath);
    writer.uninstallHook('kiro', projectPath);

    const hookFile = path.join(projectPath, '.kiro', 'hooks', 'agent-pulse.kiro.hook');
    expect(fs.existsSync(hookFile)).toBe(false);

    const scriptsDir = path.join(projectPath, '.kiro', 'hooks-scripts');
    expect(fs.existsSync(path.join(scriptsDir, 'agent-pulse.sh'))).toBe(false);
    expect(fs.existsSync(path.join(scriptsDir, 'agent-pulse.ps1'))).toBe(false);
    expect(writer.isHookInstalled('kiro', projectPath)).toBe(false);
  });

  it('falls back to ~/.kiro/hooks when no projectPath given', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('kiro');
      expect(result.success).toBe(true);

      const hookFile = path.join(tmpDir, '.kiro', 'hooks', 'agent-pulse.kiro.hook');
      expect(fs.existsSync(hookFile)).toBe(true);
    });
  });
});

// ── Antigravity CLI ──────────────────────────────────────────────────────────

describe('ConfigWriter — antigravity-cli', () => {
  const hooksJsonRelPath = path.join('.gemini', 'config', 'hooks.json');
  const scriptRelDir     = path.join('.gemini', 'config', 'agent-pulse');

  it('creates ~/.gemini/config/hooks.json with the agent-pulse group at top level', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('antigravity-cli');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('antigravity-cli')).toBe(true);

      const hooksJsonPath = path.join(tmpDir, hooksJsonRelPath);
      expect(fs.existsSync(hooksJsonPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      // Hook groups sit at the top level — NOT under a `hooks` key.
      expect(config.hooks).toBeUndefined();
      const group = config['agent-pulse'];
      expect(group).toBeDefined();
      // PreToolUse uses matcher-wrapped shape
      expect(group.PreToolUse[0].matcher).toBe('*');
      expect(group.PreToolUse[0].hooks[0].type).toBe('command');
      // PreInvocation uses flat handler shape (matcher N/A)
      expect(group.PreInvocation[0].type).toBe('command');
      expect(group.PreInvocation[0].matcher).toBeUndefined();
    });
  });

  it('passes the event name as a command-line arg to the script', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, hooksJsonRelPath), 'utf8'));
      const group = config['agent-pulse'];
      // On Windows the script path is rewritten to its 8.3 short form
      // (AGENT-~1.PS1) to dodge cmd.exe quote-mangling on usernames with spaces.
      expect(group.PreInvocation[0].command).toMatch(/(agent-pulse\.(sh|ps1)("|)|AGENT-~\d\.PS1)\s+PreInvocation$/i);
      expect(group.PreToolUse[0].hooks[0].command).toMatch(/\s+PreToolUse$/);
      expect(group.Stop[0].command).toMatch(/\s+Stop$/);
    });
  });

  it('registers all 5 Antigravity lifecycle events', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, hooksJsonRelPath), 'utf8'));
      const events = Object.keys(config['agent-pulse']);
      expect(events).toEqual(expect.arrayContaining([
        'PreInvocation', 'PreToolUse', 'PostToolUse', 'PostInvocation', 'Stop',
      ]));
      expect(events).toHaveLength(5);
    });
  });

  it('creates hook scripts (bash + ps1) under ~/.gemini/config/agent-pulse/', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const dir = path.join(tmpDir, scriptRelDir);
      expect(fs.existsSync(path.join(dir, 'agent-pulse.sh'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'agent-pulse.ps1'))).toBe(true);
    });
  });

  it('hook scripts inject _ap_tool and hook_event_name based on argv', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const shContent = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.sh'), 'utf8');
      expect(shContent).toContain('"_ap_tool":"antigravity-cli"');
      expect(shContent).toContain('hook_event_name');
      expect(shContent).toMatch(/EVENT="\$\{1:-\}"/);

      const ps1Content = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.ps1'), 'utf8');
      expect(ps1Content).toContain('"_ap_tool":"antigravity-cli"');
      expect(ps1Content).toContain('hook_event_name');
      expect(ps1Content).toMatch(/param\(\[string\]\$Event/);
    });
  });

  it('PreToolUse and Stop emit decision:allow; other events emit empty object', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const shContent = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.sh'), 'utf8');
      expect(shContent).toContain('"decision":"allow"');
      expect(shContent).toContain(`printf '{}'`);
      expect(shContent).toMatch(/PreToolUse\|Stop/);
      const ps1Content = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.ps1'), 'utf8');
      expect(ps1Content).toContain('"decision":"allow"');
      expect(ps1Content).toMatch(/\[Console\]::Out\.Write\('\{\}'\)/);
      expect(ps1Content).toMatch(/\$Event -eq 'PreToolUse' -or \$Event -eq 'Stop'/);
    });
  });

  it('hook scripts exit 0', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const shContent = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.sh'), 'utf8');
      expect(shContent).toContain('exit 0');
      const ps1Content = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.ps1'), 'utf8');
      expect(ps1Content).toContain('exit 0');
    });
  });

  it('hook scripts capture the response and relay a guardrail deny over allow', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      const shContent = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.sh'), 'utf8');
      // Response is captured (not discarded) and a block is relayed verbatim.
      expect(shContent).not.toContain('-o /dev/null');
      expect(shContent).toContain('RESP=$(curl');
      expect(shContent).toContain('"status":"blocked"');
      expect(shContent).toContain('printf \'%s\' "$RESP"');

      const ps1Content = fs.readFileSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.ps1'), 'utf8');
      expect(ps1Content).toContain('"status":"blocked"');
      expect(ps1Content).toContain('[Console]::Out.Write($verdict)');
    });
  });

  it('preserves other hook groups in hooks.json when merging', async () => {
    await withFakeHome(async (writer) => {
      const configDir = path.join(tmpDir, '.gemini', 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'hooks.json'),
        JSON.stringify({ 'my-linter': { PostToolUse: [{ matcher: '*', hooks: [] }] } }, null, 2),
      );

      await writer.installHook('antigravity-cli');
      const config = JSON.parse(fs.readFileSync(path.join(configDir, 'hooks.json'), 'utf8'));
      expect(config['my-linter']).toBeDefined();
      expect(config['agent-pulse']).toBeDefined();
    });
  });

  it('uninstall removes the agent-pulse group and scripts', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('antigravity-cli');
      writer.uninstallHook('antigravity-cli');

      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, hooksJsonRelPath), 'utf8'));
      expect(config['agent-pulse']).toBeUndefined();

      expect(fs.existsSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.sh'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, scriptRelDir, 'agent-pulse.ps1'))).toBe(false);
      expect(writer.isHookInstalled('antigravity-cli')).toBe(false);
    });
  });

  it('workspace install writes to <project>/.agents/hooks.json', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    const result = await writer.installHook('antigravity-cli', projectPath);
    expect(result.success).toBe(true);
    expect(writer.isHookInstalled('antigravity-cli', projectPath)).toBe(true);

    const hooksJson = path.join(projectPath, '.agents', 'hooks.json');
    expect(fs.existsSync(hooksJson)).toBe(true);
    const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    expect(config['agent-pulse']).toBeDefined();
  });
});

// ── Grok ──────────────────────────────────────────────────────────────────────

describe('ConfigWriter — grok', () => {
  it('creates ~/.grok/hooks/agent-pulse.json with command hooks + scripts', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('grok');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('grok')).toBe(true);

      const hookPath = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.json');
      expect(fs.existsSync(hookPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      const hook = config.hooks.PreToolUse[0].hooks[0];
      // Grok's SSRF protection blocks http:// URLs for `type: "http"` hooks, so
      // we use a command hook (script POSTs to the bridge instead).
      expect(hook.type).toBe('command');
      expect(hook.command).toContain('agent-pulse');
      expect(config.hooks.SessionStart).toBeDefined();
      expect(config.hooks.StopFailure).toBeDefined();
      // Grok's matcher is a regex, so PreToolUse uses '.*', not Claude's '*'.
      expect(config.hooks.PreToolUse[0].matcher).toBe('.*');

      // The hook scripts must exist and inject the grok identifier.
      const shPath  = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.sh');
      const ps1Path = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.ps1');
      expect(fs.existsSync(shPath)).toBe(true);
      expect(fs.existsSync(ps1Path)).toBe(true);
      const sh  = fs.readFileSync(shPath, 'utf8');
      const ps1 = fs.readFileSync(ps1Path, 'utf8');
      expect(sh).toContain('"_ap_tool":"grok"');
      expect(ps1).toContain('"_ap_tool":"grok"');
      // Token analytics resolve the session dir from sessionId — the scripts
      // inject a GROK_SESSION_ID fallback so resolution can't be starved.
      expect(sh).toContain('GROK_SESSION_ID');
      expect(ps1).toContain('GROK_SESSION_ID');
    });
  });

  it('uninstall removes the hook scripts too', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('grok');
      const shPath  = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.sh');
      const ps1Path = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.ps1');
      expect(fs.existsSync(shPath)).toBe(true);

      writer.uninstallHook('grok');
      expect(fs.existsSync(shPath)).toBe(false);
      expect(fs.existsSync(ps1Path)).toBe(false);
    });
  });

  it('is idempotent on re-install', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('grok');
      await writer.installHook('grok');
      expect(writer.isHookInstalled('grok')).toBe(true);
    });
  });

  it('uninstall removes only the Agent Pulse hook file', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('grok');
      // Drop a sibling hook file to prove we don't touch other Grok hooks.
      const siblingPath = path.join(tmpDir, '.grok', 'hooks', 'other-plugin.json');
      fs.writeFileSync(siblingPath, '{"hooks":{}}');

      writer.uninstallHook('grok');
      expect(writer.isHookInstalled('grok')).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.json'))).toBe(false);
      expect(fs.existsSync(siblingPath)).toBe(true);
    });
  });

  it('honors GROK_HOME for the hook location', async () => {
    await withFakeHome(async (writer) => {
      const grokHome = path.join(tmpDir, 'custom-grok');
      const prev = process.env['GROK_HOME'];
      process.env['GROK_HOME'] = grokHome;
      try {
        await writer.installHook('grok');
        expect(fs.existsSync(path.join(grokHome, 'hooks', 'agent-pulse.json'))).toBe(true);
        expect(writer.isHookInstalled('grok')).toBe(true);
      } finally {
        if (prev === undefined) delete process.env['GROK_HOME'];
        else process.env['GROK_HOME'] = prev;
      }
    });
  });
});

// ── Grok ──────────────────────────────────────────────────────────────────────

describe('ConfigWriter — grok', () => {
  it('creates ~/.grok/hooks/agent-pulse.json with command hooks', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('grok');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('grok')).toBe(true);

      const hookPath = path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.json');
      expect(fs.existsSync(hookPath)).toBe(true);

      // Grok's SSRF protection rejects http:// hook URLs, so we install a
      // COMMAND hook that POSTs to the bridge via a script instead.
      const config = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
      const hook = config.hooks.PreToolUse[0].hooks[0];
      expect(hook.type).toBe('command');
      expect(hook.command).toBeTruthy();
      expect(config.hooks.SessionStart).toBeDefined();
      expect(config.hooks.StopFailure).toBeDefined();
      // Grok's matcher is a regex, so PreToolUse uses '.*', not Claude's '*'.
      expect(config.hooks.PreToolUse[0].matcher).toBe('.*');

      // The command hook references scripts that must exist on disk.
      const hooksDir = path.join(tmpDir, '.grok', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'agent-pulse.sh'))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, 'agent-pulse.ps1'))).toBe(true);
    });
  });

  it('is idempotent on re-install', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('grok');
      await writer.installHook('grok');
      expect(writer.isHookInstalled('grok')).toBe(true);
    });
  });

  it('uninstall removes only the Agent Pulse hook file', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('grok');
      // Drop a sibling hook file to prove we don't touch other Grok hooks.
      const siblingPath = path.join(tmpDir, '.grok', 'hooks', 'other-plugin.json');
      fs.writeFileSync(siblingPath, '{"hooks":{}}');

      writer.uninstallHook('grok');
      expect(writer.isHookInstalled('grok')).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.grok', 'hooks', 'agent-pulse.json'))).toBe(false);
      expect(fs.existsSync(siblingPath)).toBe(true);
    });
  });

  it('honors GROK_HOME for the hook location', async () => {
    await withFakeHome(async (writer) => {
      const grokHome = path.join(tmpDir, 'custom-grok');
      const prev = process.env['GROK_HOME'];
      process.env['GROK_HOME'] = grokHome;
      try {
        await writer.installHook('grok');
        expect(fs.existsSync(path.join(grokHome, 'hooks', 'agent-pulse.json'))).toBe(true);
        expect(writer.isHookInstalled('grok')).toBe(true);
      } finally {
        if (prev === undefined) delete process.env['GROK_HOME'];
        else process.env['GROK_HOME'] = prev;
      }
    });
  });
});

// ── OpenCode ──────────────────────────────────────────────────────────────────
// OpenCode has no shell-hook config; we install a JS plugin instead. Paths are
// ~/.config/opencode on every platform (verified on 1.18.18) — Windows does NOT
// use %APPDATA% here.

describe('ConfigWriter — opencode', () => {
  // XDG_CONFIG_HOME would redirect the config dir if it happened to be set in
  // the test environment; pin it off so these assertions are deterministic.
  let savedXdg: string | undefined;
  beforeEach(() => {
    savedXdg = process.env['XDG_CONFIG_HOME'];
    delete process.env['XDG_CONFIG_HOME'];
  });
  afterEach(() => {
    if (savedXdg !== undefined) process.env['XDG_CONFIG_HOME'] = savedXdg;
  });

  const pluginPath = () => path.join(tmpDir, '.config', 'opencode', 'plugins', 'agent-pulse.js');

  it('writes the plugin to ~/.config/opencode/plugins/agent-pulse.js', async () => {
    await withFakeHome(async (writer) => {
      expect(writer.isHookInstalled('opencode')).toBe(false);

      const result: any = await writer.installHook('opencode');
      expect(result.success).toBe(true);
      expect(result.path).toBe(pluginPath());
      expect(fs.existsSync(pluginPath())).toBe(true);
      expect(writer.isHookInstalled('opencode')).toBe(true);
    });
  });

  it('creates the plugins directory when it does not exist', async () => {
    await withFakeHome(async (writer) => {
      expect(fs.existsSync(path.join(tmpDir, '.config'))).toBe(false);
      await writer.installHook('opencode');
      expect(fs.existsSync(pluginPath())).toBe(true);
    });
  });

  it('emits a dependency-free ESM plugin pointed at the bridge', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('opencode');
      const src = fs.readFileSync(pluginPath(), 'utf8');

      expect(src).toContain('export const AgentPulse');
      expect(src).toContain('localhost:4242');
      // No imports at all: a `@opencode-ai/plugin` import would make OpenCode
      // install ~49MB of node_modules into the user's config dir on next boot.
      expect(src).not.toMatch(/^\s*import\s/m);
      expect(src).not.toContain('require(');
      // The three signals the bubble depends on.
      expect(src).toContain('session.status');
      expect(src).toContain('session.error');
      expect(src).toContain('permission.asked');
    });
  });

  it('is idempotent — reinstalling overwrites in place', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('opencode');
      const first = fs.readFileSync(pluginPath(), 'utf8');
      await writer.installHook('opencode');
      expect(fs.readFileSync(pluginPath(), 'utf8')).toBe(first);
      expect(fs.readdirSync(path.dirname(pluginPath()))).toEqual(['agent-pulse.js']);
    });
  });

  it('detects a plugin installed under the legacy singular plugin/ dir', async () => {
    await withFakeHome(async (writer) => {
      const legacy = path.join(tmpDir, '.config', 'opencode', 'plugin');
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, 'agent-pulse.js'), '// placeholder');
      expect(writer.isHookInstalled('opencode')).toBe(true);
    });
  });

  it('uninstall removes our plugin from both dir spellings and leaves others alone', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('opencode');
      const pluginsDir = path.dirname(pluginPath());
      fs.writeFileSync(path.join(pluginsDir, 'someone-elses.js'), '// keep me');

      const legacy = path.join(tmpDir, '.config', 'opencode', 'plugin');
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, 'agent-pulse.js'), '// stale copy');

      writer.uninstallHook('opencode');

      expect(fs.existsSync(pluginPath())).toBe(false);
      expect(fs.existsSync(path.join(legacy, 'agent-pulse.js'))).toBe(false);
      // The user's own plugin and the directory itself survive.
      expect(fs.existsSync(path.join(pluginsDir, 'someone-elses.js'))).toBe(true);
      expect(fs.existsSync(pluginsDir)).toBe(true);
      expect(writer.isHookInstalled('opencode')).toBe(false);
    });
  });

  it('uninstall is safe when nothing is installed', async () => {
    await withFakeHome(async (writer) => {
      expect(writer.uninstallHook('opencode')).toEqual({ success: true });
    });
  });

  it('emits the gated block round-trip machinery', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('opencode');
      const src = fs.readFileSync(pluginPath(), 'utf8');

      expect(src).toContain('AbortController');
      expect(src).toContain('GATE_TIMEOUT_MS');
      expect(src).toContain('canBlock');
      expect(src).toContain('filePath');
      // The plugin body is emitted from a TS template literal — a stray
      // backtick or ${} would corrupt the generated source.
      expect(src).not.toContain('`');
      expect(src).not.toContain('${');
    });
  });

  describe('refreshOpencodePlugin', () => {
    it('does nothing when the plugin is not installed', async () => {
      await withFakeHome(async (writer) => {
        expect(writer.refreshOpencodePlugin()).toBe(false);
        expect(fs.existsSync(pluginPath())).toBe(false);
      });
    });

    it('rewrites stale copies in both dir spellings', async () => {
      await withFakeHome(async (writer) => {
        await writer.installHook('opencode');
        fs.writeFileSync(pluginPath(), '// stale v1 plugin');
        const legacy = path.join(tmpDir, '.config', 'opencode', 'plugin');
        fs.mkdirSync(legacy, { recursive: true });
        const legacyFile = path.join(legacy, 'agent-pulse.js');
        fs.writeFileSync(legacyFile, '// stale v1 plugin');

        expect(writer.refreshOpencodePlugin()).toBe(true);

        const fresh = fs.readFileSync(pluginPath(), 'utf8');
        expect(fresh).toContain('GATE_TIMEOUT_MS');
        expect(fs.readFileSync(legacyFile, 'utf8')).toBe(fresh);
      });
    });

    it('leaves an up-to-date plugin untouched', async () => {
      await withFakeHome(async (writer) => {
        await writer.installHook('opencode');
        const before = fs.statSync(pluginPath()).mtimeMs;
        expect(writer.refreshOpencodePlugin()).toBe(false);
        expect(fs.statSync(pluginPath()).mtimeMs).toBe(before);
      });
    });
  });
});

// ── Unknown tool throws ───────────────────────────────────────────────────────

describe('ConfigWriter — unknown tool', () => {
  it('rejects for an unrecognized toolId', async () => {
    const writer = new ConfigWriter();
    await expect(writer.installHook('unknown-ide' as any)).rejects.toThrow();
  });
});

// ── Status line ───────────────────────────────────────────────────────────────

const sampleStatusLine: StatusLineConfig = {
  version: 1,
  separator: '  ·  ',
  lines: [
    {
      segments: [
        { type: 'model', enabled: true, color: 'white' },
        { type: 'contextBar', enabled: true, color: 'auto', width: 10, showPercent: true },
      ],
    },
  ],
};

describe('ConfigWriter — status line', () => {
  it('reports state none on a fresh machine', async () => {
    await withFakeHome(async (writer) => {
      expect(writer.statusLineState()).toBe('none');
    });
  });

  it('installs the statusLine key and projects the config, preserving other settings', async () => {
    await withFakeHome(async (writer) => {
      // Pre-existing settings the installer must not clobber.
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus', hooks: { Stop: [] } }));

      const result = writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
      expect(result.success).toBe(true);
      expect(result.state).toBe('ours');
      expect(writer.statusLineState()).toBe('ours');

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.model).toBe('opus');         // untouched
      expect(settings.hooks.Stop).toBeDefined();    // untouched
      expect(settings.statusLine.type).toBe('command');
      expect(settings.statusLine.command).toContain('node');
      expect(settings.statusLine.command).toContain('statusline.js');

      // The deployed script + config projection exist.
      const dir = path.join(tmpDir, '.claude', 'agent-pulse');
      expect(fs.existsSync(path.join(dir, 'statusline.js'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'statusline.config.json'))).toBe(true);
    });
  });

  it('does NOT back up settings when there is no prior status line', async () => {
    await withFakeHome(async (writer) => {
      writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
      const claudeDir = path.join(tmpDir, '.claude');
      const backups = fs.readdirSync(claudeDir).filter((f) => f.startsWith('settings.backup-'));
      expect(backups.length).toBe(0);
    });
  });

  it('backs up a FOREIGN status line before replacing it', async () => {
    await withFakeHome(async (writer) => {
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'echo custom' } }));
      expect(writer.statusLineState()).toBe('foreign');

      const result = writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
      expect(result.backup).toBeTruthy();
      expect(fs.existsSync(result.backup as string)).toBe(true);

      // The backup retains the original foreign command.
      const backed = JSON.parse(fs.readFileSync(result.backup as string, 'utf8'));
      expect(backed.statusLine.command).toBe('echo custom');
      expect(writer.statusLineState()).toBe('ours');
    });
  });

  it('removes only the statusLine key, leaving other settings intact', async () => {
    await withFakeHome(async (writer) => {
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus' }));
      writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');

      writer.removeStatusLine();
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.statusLine).toBeUndefined();
      expect(settings.model).toBe('opus');
      expect(writer.statusLineState()).toBe('none');
    });
  });

  it('installedStatusLineRuntime reports the wired-in runtime, and refreshes the same script', async () => {
    await withFakeHome(async (writer) => {
      writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
      expect(writer.installedStatusLineRuntime()).toBe('node');

      // A refresh rewrites the deployed script (current app version) in place.
      const scriptPath = path.join(tmpDir, '.claude', 'agent-pulse', 'statusline.js');
      fs.writeFileSync(scriptPath, '// stale');
      writer.deployStatusLineScript('node');
      const refreshed = fs.readFileSync(scriptPath, 'utf8');
      expect(refreshed).not.toBe('// stale');
      expect(refreshed).toContain('renderSegment');
    });
  });

  it('reports null installed runtime on a fresh machine', async () => {
    await withFakeHome(async (writer) => {
      expect(writer.installedStatusLineRuntime()).toBeNull();
    });
  });

  it('builds a PowerShell command with the -File form', async () => {
    await withFakeHome(async (writer) => {
      writer.installStatusLine(sampleStatusLine, 'powershell', 'powershell');
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.statusLine.command).toContain('-ExecutionPolicy Bypass -File');
      expect(settings.statusLine.command).toContain('statusline.ps1');
    });
  });

  it('projects bridgeStatusUrl into statusline.config.json (not into UserConfig)', async () => {
    await withFakeHome(async (writer) => {
      writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
      const cfgPath = path.join(tmpDir, '.claude', 'agent-pulse', 'statusline.config.json');
      const projected = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      expect(projected.bridgeStatusUrl).toBe('http://127.0.0.1:4242/statusline');
      // The rest of the projection is still the user's statusline config.
      expect(projected.lines).toEqual(sampleStatusLine.lines);
    });
  });

  it('projects pulseToken from ~/.agent-pulse/mcp.json into statusline.config.json and scripts send it', async () => {
    await withFakeHome(async (writer) => {
      const prevPort = process.env.AGENT_PULSE_BRIDGE_PORT;
      const prevToken = process.env.AGENT_PULSE_MCP_TOKEN;
      delete process.env.AGENT_PULSE_BRIDGE_PORT;
      delete process.env.AGENT_PULSE_MCP_TOKEN;
      try {
        const connDir = path.join(tmpDir, '.agent-pulse');
        fs.mkdirSync(connDir, { recursive: true });
        fs.writeFileSync(path.join(connDir, 'mcp.json'), JSON.stringify({ port: 4242, token: 'abc' }));

        writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
        const cfgPath = path.join(tmpDir, '.claude', 'agent-pulse', 'statusline.config.json');
        const projected = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        expect(projected.pulseToken).toBe('abc');

        for (const runtime of ['node', 'python', 'powershell'] as const) {
          const scriptPath = writer.deployStatusLineScript(runtime);
          expect(fs.readFileSync(scriptPath, 'utf8')).toContain('x-pulse-token');
        }
      } finally {
        if (prevPort !== undefined) process.env.AGENT_PULSE_BRIDGE_PORT = prevPort;
        if (prevToken !== undefined) process.env.AGENT_PULSE_MCP_TOKEN = prevToken;
      }
    });
  });

  it('omits pulseToken when no connection file exists', async () => {
    await withFakeHome(async (writer) => {
      const prevPort = process.env.AGENT_PULSE_BRIDGE_PORT;
      const prevToken = process.env.AGENT_PULSE_MCP_TOKEN;
      delete process.env.AGENT_PULSE_BRIDGE_PORT;
      delete process.env.AGENT_PULSE_MCP_TOKEN;
      try {
        writer.installStatusLine(sampleStatusLine, 'node', '/usr/bin/node');
        const cfgPath = path.join(tmpDir, '.claude', 'agent-pulse', 'statusline.config.json');
        const projected = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        expect('pulseToken' in projected).toBe(false);
      } finally {
        if (prevPort !== undefined) process.env.AGENT_PULSE_BRIDGE_PORT = prevPort;
        if (prevToken !== undefined) process.env.AGENT_PULSE_MCP_TOKEN = prevToken;
      }
    });
  });

  it('all three deployed scripts contain the bridge POST and stay template-safe', async () => {
    await withFakeHome(async (writer) => {
      for (const runtime of ['node', 'python', 'powershell'] as const) {
        const scriptPath = writer.deployStatusLineScript(runtime);
        const script = fs.readFileSync(scriptPath, 'utf8');
        expect(script).toContain('bridgeStatusUrl');
        // The generating template literals forbid backslash, backtick, and
        // "${" in the script bodies (see the comment above the builders).
        // The PowerShell BOM prefix is the only allowed non-template byte.
        const body = runtime === 'powershell' ? script.replace(/^﻿/, '') : script;
        expect(body.includes('\\')).toBe(false);
        expect(body.includes('`')).toBe(false);
        expect(body.includes('${')).toBe(false);
      }
    });
  });
});

describe('ToolDetector — status line runtime', () => {
  it('detects a runtime with an absolute interpreter path (node in the test env)', async () => {
    const detected = await new ToolDetector().detectStatusLineRuntime();
    expect(detected).not.toBeNull();
    expect(detected?.runtime).toBe('node');
    expect(detected?.binPath && detected.binPath.length).toBeGreaterThan(0);
  });
});

describe('statusline-render — reference renderer', () => {
  it('renders enabled segments, skips disabled ones, and joins by separator', () => {
    const out = renderStatusLine(sampleStatusLine, {
      model: { display_name: 'Opus 4.8' },
      context_window: { used_percentage: 50 },
    });
    expect(out.lines[0].segments.map((s) => s.text)).toEqual([
      'Opus 4.8',
      '[█████░░░░░] 50%',
    ]);
    // 50% lands on the yellow threshold.
    expect(out.lines[0].segments[1].color).toBe('yellow');
    expect(out.text).toBe('Opus 4.8  ·  [█████░░░░░] 50%');
  });

  it('prefixes a segment icon (sharing the segment color)', () => {
    const withIcon: StatusLineConfig = {
      version: 1,
      separator: '  ·  ',
      lines: [{ segments: [{ type: 'model', enabled: true, color: 'white', icon: '🧠' }] }],
    };
    const out = renderStatusLine(withIcon, { model: { display_name: 'Opus 4.8' } });
    expect(out.lines[0].segments[0].text).toBe('🧠 Opus 4.8');
  });

  it('wraps a crowded line into multiple rows at maxItemsPerLine', () => {
    const crowded: StatusLineConfig = {
      version: 1,
      separator: ' | ',
      maxItemsPerLine: 2,
      lines: [{
        segments: [
          { type: 'model', enabled: true },
          { type: 'cwd', enabled: true, basenameOnly: true },
          { type: 'gitBranch', enabled: true },
        ],
      }],
    };
    const out = renderStatusLine(crowded, {
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/x/agent-pulse', git_worktree: 'main' },
    });
    // 3 segments, wrap after 2 → two rows (2 + 1).
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].segments.map((s) => s.text)).toEqual(['Opus', 'agent-pulse']);
    expect(out.lines[1].segments.map((s) => s.text)).toEqual(['main']);
    expect(out.text).toBe('Opus | agent-pulse\nmain');
  });

  it('renders each config line as its own output line', () => {
    const twoLines: StatusLineConfig = {
      version: 1,
      separator: '  ·  ',
      lines: [
        { segments: [{ type: 'model', enabled: true }] },
        { segments: [{ type: 'cwd', enabled: true, basenameOnly: true }] },
      ],
    };
    const out = renderStatusLine(twoLines, {
      model: { display_name: 'Opus' },
      workspace: { current_dir: '/home/me/agent-pulse' },
    });
    expect(out.text).toBe('Opus\nagent-pulse');
  });

  it('skips a segment whose field is absent', () => {
    const out = renderStatusLine(sampleStatusLine, { model: { display_name: 'Opus' } });
    // contextBar dropped (no context_window) — only the model remains.
    expect(out.lines[0].segments.map((s) => s.text)).toEqual(['Opus']);
  });
});
