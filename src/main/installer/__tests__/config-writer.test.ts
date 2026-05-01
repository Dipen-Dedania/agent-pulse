import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigWriter } from '../config-writer';

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
    writer.uninstallHook('cursor', projectPath);

    const shPath = path.join(projectPath, '.cursor', 'hooks', 'agent-pulse.sh');
    expect(fs.existsSync(shPath)).toBe(false);

    const hooksJson = path.join(projectPath, '.cursor', 'hooks.json');
    const config = JSON.parse(fs.readFileSync(hooksJson, 'utf8'));
    // hooks key is removed entirely when all events are deleted
    expect(config.hooks).toBeUndefined();
  });
});

// ── VS Code Copilot ───────────────────────────────────────────────────────────

describe('ConfigWriter — vscode-copilot', () => {
  it('creates agent-pulse-hooks.json under .github/hooks', async () => {
    const projectPath = path.join(tmpDir, 'my-project');
    const writer = new ConfigWriter();
    const result = await writer.installHook('vscode-copilot', projectPath);
    expect(result.success).toBe(true);

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
  });
});

// ── OpenAI Codex ──────────────────────────────────────────────────────────────

describe('ConfigWriter — openai-codex', () => {
  it('creates hooks.json and enables codex_hooks in config.toml', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('openai-codex');
      expect(result.success).toBe(true);

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

// ── Gemini CLI ───────────────────────────────────────────────────────────────

describe('ConfigWriter — gemini-cli', () => {
  it('creates ~/.gemini/settings.json with hook entries', async () => {
    await withFakeHome(async (writer) => {
      const result = await writer.installHook('gemini-cli');
      expect(result.success).toBe(true);

      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.BeforeTool).toBeDefined();
      expect(settings.hooks.AfterAgent).toBeDefined();

      const hook = settings.hooks.SessionStart[0].hooks[0];
      expect(hook.name).toBe('agent-pulse');
      expect(hook.type).toBe('command');
    });
  });

  it('registers all 7 Gemini lifecycle events', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('gemini-cli');
      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const events = Object.keys(settings.hooks);
      expect(events).toEqual(expect.arrayContaining([
        'SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent',
        'BeforeTool', 'AfterTool', 'Notification',
      ]));
      expect(events).toHaveLength(7);
    });
  });

  it('creates hook scripts (bash + ps1) under ~/.gemini/hooks/', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('gemini-cli');
      const hooksDir = path.join(tmpDir, '.gemini', 'hooks');
      expect(fs.existsSync(path.join(hooksDir, 'agent-pulse.sh'))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, 'agent-pulse.ps1'))).toBe(true);
    });
  });

  it('hook scripts inject tool identifier', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('gemini-cli');
      const shPath = path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.sh');
      const shContent = fs.readFileSync(shPath, 'utf8');
      expect(shContent).toContain('"_ap_tool":"gemini-cli"');

      const ps1Path = path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.ps1');
      const ps1Content = fs.readFileSync(ps1Path, 'utf8');
      expect(ps1Content).toContain('"_ap_tool":"gemini-cli"');
    });
  });

  it('hook scripts exit 0', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('gemini-cli');
      const shContent = fs.readFileSync(path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.sh'), 'utf8');
      expect(shContent).toContain('exit 0');
      const ps1Content = fs.readFileSync(path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.ps1'), 'utf8');
      expect(ps1Content).toContain('exit 0');
    });
  });

  it('preserves existing settings.json keys when merging', async () => {
    await withFakeHome(async (writer) => {
      const geminiDir = path.join(tmpDir, '.gemini');
      fs.mkdirSync(geminiDir, { recursive: true });
      fs.writeFileSync(
        path.join(geminiDir, 'settings.json'),
        JSON.stringify({ theme: 'dark', model: 'gemini-2.5-pro' }, null, 2),
      );

      await writer.installHook('gemini-cli');
      const settings = JSON.parse(fs.readFileSync(path.join(geminiDir, 'settings.json'), 'utf8'));
      expect(settings.theme).toBe('dark');
      expect(settings.model).toBe('gemini-2.5-pro');
      expect(settings.hooks.SessionStart).toBeDefined();
    });
  });

  it('uninstall removes hook entries and scripts', async () => {
    await withFakeHome(async (writer) => {
      await writer.installHook('gemini-cli');
      writer.uninstallHook('gemini-cli');

      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeUndefined();

      const shPath = path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.sh');
      expect(fs.existsSync(shPath)).toBe(false);
      const ps1Path = path.join(tmpDir, '.gemini', 'hooks', 'agent-pulse.ps1');
      expect(fs.existsSync(ps1Path)).toBe(false);
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
