import { describe, it, expect } from 'vitest';
import { parseCodexDefaultModel } from '../codex-settings';
import { renderCodexQaProfile } from '../codex-qa-profile';

describe('parseCodexDefaultModel', () => {
  it('reads the root-table model key (shape of a real ~/.codex/config.toml)', () => {
    const toml = [
      'model = "gpt-6-astra"',
      'model_reasoning_effort = "medium"',
      '',
      '[windows]',
      'sandbox = "elevated"',
      '',
      "[projects.'E:\\DDrive\\Github\\agent-pulse']",
      'trust_level = "trusted"',
    ].join('\n');
    expect(parseCodexDefaultModel(toml)).toBe('gpt-6-astra');
  });

  it('ignores a model key inside a profile table and tolerates BOM / comments / single quotes', () => {
    expect(parseCodexDefaultModel('[profiles.fast]\nmodel = "gpt-5-mini"\n')).toBeNull();
    expect(parseCodexDefaultModel("\uFEFFmodel = 'gpt-5-codex' # default\n")).toBe('gpt-5-codex');
    expect(parseCodexDefaultModel('# nothing here\n')).toBeNull();
  });

  it('rejects an unsafe value rather than passing it toward argv', () => {
    expect(parseCodexDefaultModel('model = "x && del *"\n')).toBeNull();
  });
});

describe('renderCodexQaProfile', () => {
  it('declares the headless, isolated chrome-devtools MCP server', () => {
    const posix = renderCodexQaProfile('linux');
    expect(posix).toContain('[mcp_servers.chrome-devtools]');
    expect(posix).toContain('command = "npx"');
    expect(posix).toContain('args = ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"]');
    const win = renderCodexQaProfile('win32');
    expect(win).toContain('command = "cmd"');
    expect(win).toContain('args = ["/c", "npx", "-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"]');
    expect(win.endsWith('\n')).toBe(true);
  });
});
