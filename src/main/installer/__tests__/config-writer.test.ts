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
  it('creates hooks.json and enables codex_hooks in config.toml', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('openai-codex');
      expect(result.success).toBe(true);
      expect(writer.isHookInstalled('openai-codex')).toBe(true);

      const hooksJson = path.join(tmpDir, '.codex', 'hooks.json');
      expect(fs.existsSync(hooksJson)).toBe(true);
      const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
      expect(config.hooks.PreToolUse).toBeDefined();

      const toml = fs.readFileSync(path.join(tmpDir, '.codex', 'config.toml'), 'utf8');
      expect(toml).toContain('codex_hooks = true');
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
});

describe('ToolDetector — status line runtime', () => {
  it('detects a runtime with an absolute interpreter path (node in the test env)', () => {
    const detected = new ToolDetector().detectStatusLineRuntime();
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
