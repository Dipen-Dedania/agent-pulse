import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  buildMcpEntry,
  codexMcpConflict,
  codexTableBody,
  entryMatches,
  getCodexMcpStatus,
  installCodexMcpServer,
  readCodexPulseServer,
  serverScriptPath,
  uninstallCodexMcpServer,
  withCodexPulseServer,
  withoutCodexPulseServer,
} from '../install';
import { parseTableHeader } from '../../installer/codex-toml';

const entry = buildMcpEntry('C:\\apps\\Agent Pulse.exe', 'C:\\apps\\resources\\app.asar\\dist\\main\\mcp\\server.js');

const TABLE = [
  '[mcp_servers.agent-pulse]',
  'command = "C:\\\\apps\\\\Agent Pulse.exe"',
  'args = ["C:\\\\apps\\\\resources\\\\app.asar\\\\dist\\\\main\\\\mcp\\\\server.js"]',
  'env = { ELECTRON_RUN_AS_NODE = "1" }',
].join('\n');

// Shape of a real ~/.codex/config.toml: root keys, quoted sub-tables, a
// foreign MCP server and its env sub-table, a comment.
const REAL = [
  '# my codex config',
  'model = "gpt-6-astra"',
  '',
  '[features]',
  'hooks = true',
  '',
  '[mcp_servers.chrome-devtools]',
  'command = "npx"',
  'args = ["chrome-devtools-mcp@latest"]',
  '',
  '[mcp_servers.chrome-devtools.env]',
  'DEBUG = "1"',
  '',
  "[projects.'E:\\DDrive\\Github\\agent-pulse']",
  'trust_level = "trusted"',
  '',
].join('\n');

describe('codexTableBody', () => {
  it('writes command, args and an inline env table as escaped TOML basic strings', () => {
    expect(['[mcp_servers.agent-pulse]', ...codexTableBody(entry)].join('\n')).toBe(TABLE);
  });
});

describe('withCodexPulseServer / withoutCodexPulseServer', () => {
  it('appends our table after existing tables without disturbing them', () => {
    const out = withCodexPulseServer(REAL, entry);
    expect(out).toBe(`${REAL}\n${TABLE}\n`);
  });

  it('creates the file content from empty', () => {
    expect(withCodexPulseServer('', entry)).toBe(`${TABLE}\n`);
  });

  it('is idempotent', () => {
    const once = withCodexPulseServer(REAL, entry);
    expect(withCodexPulseServer(once, entry)).toBe(once);
  });

  it('replaces a stale table in place, keeping its position and the tables around it', () => {
    const stale = buildMcpEntry('C:\\old\\Agent Pulse.exe', 'C:\\old\\server.js');
    const before = withCodexPulseServer(REAL, stale).replace(/\n$/, '') + '\n\n[tui]\ntheme = "dark"\n';
    const after = withCodexPulseServer(before, entry);
    expect(after).toBe(`${REAL}\n${TABLE}\n\n[tui]\ntheme = "dark"\n`);
  });

  it('matches a quoted header and drops a hand-written env sub-table', () => {
    const src = '[mcp_servers."agent-pulse"]\ncommand = "node"\n\n[mcp_servers.agent-pulse.env]\nX = "1"\n\n[features]\nhooks = true\n';
    const body = TABLE.split('\n').slice(1).join('\n');
    expect(withCodexPulseServer(src, entry)).toBe(`[mcp_servers."agent-pulse"]\n${body}\n\n[features]\nhooks = true\n`);
  });

  it('keeps keys the user added to our table when reconnecting a stale entry', () => {
    const stale = buildMcpEntry('C:\\old\\Agent Pulse.exe', 'C:\\old\\server.js');
    const before = withCodexPulseServer('', stale).replace(/\n$/, '') + '\nenabled = false\nstartup_timeout_sec = 30\n';
    const after = withCodexPulseServer(before, entry);
    expect(after).toBe(`${TABLE}\nenabled = false\nstartup_timeout_sec = 30\n`);
    expect(withCodexPulseServer(after, entry)).toBe(after);
  });

  it('replaces a hand-wrapped multi-line args array and leaves the user key between ours', () => {
    const src = '[mcp_servers.agent-pulse]\ncommand = "node"\nenabled = true\nargs = [\n  "old.js",\n]\n';
    expect(withCodexPulseServer(src, entry)).toBe(`${TABLE}\nenabled = true\n`);
  });

  it('keeps sub-tables that do not clash with a key we write', () => {
    const src = '[mcp_servers.agent-pulse]\ncommand = "node"\n\n[mcp_servers.agent-pulse.tools.add_backlog_card]\napproval = "auto"\n';
    expect(withCodexPulseServer(src, entry)).toBe(
      `${TABLE}\n\n[mcp_servers.agent-pulse.tools.add_backlog_card]\napproval = "auto"\n`,
    );
  });

  it('removes only our table and restores the original file byte for byte', () => {
    const installed = withCodexPulseServer(REAL, entry);
    expect(withoutCodexPulseServer(installed)).toBe(REAL);
  });

  it('keeps a comment that introduces the next table when removing ours', () => {
    const src = `${TABLE}\n\n# browser tools\n[mcp_servers.chrome-devtools]\ncommand = "npx"\n`;
    expect(withoutCodexPulseServer(src)).toBe('\n# browser tools\n[mcp_servers.chrome-devtools]\ncommand = "npx"\n');
  });

  it('is a no-op when our table is absent', () => {
    expect(withoutCodexPulseServer(REAL)).toBe(REAL);
  });

  it('preserves CRLF and a BOM', () => {
    const src = '\uFEFF[features]\r\nhooks = true\r\n';
    const out = withCodexPulseServer(src, entry);
    expect(out).toBe(`\uFEFF[features]\r\nhooks = true\r\n\r\n${TABLE.split('\n').join('\r\n')}\r\n`);
    expect(withoutCodexPulseServer(out)).toBe(src);
  });
});

describe('readCodexPulseServer', () => {
  it('reads back what we wrote so the status check can compare it', () => {
    const read = readCodexPulseServer(withCodexPulseServer(REAL, entry));
    expect(read).toEqual({ command: entry.command, args: entry.args });
    expect(entryMatches(read, entry)).toBe(true);
    expect(entryMatches(read, buildMcpEntry('C:\\moved\\Agent Pulse.exe', entry.args[0]))).toBe(false);
  });

  it('understands literal strings and multi-line arrays', () => {
    const src = "[mcp_servers.agent-pulse]\ncommand = 'C:\\x.exe'\nargs = [\n  'a.js', # first\n  \"b.js\",\n]\n";
    expect(readCodexPulseServer(src)).toEqual({ command: 'C:\\x.exe', args: ['a.js', 'b.js'] });
  });

  it('is null without our table, even when other servers exist', () => {
    expect(readCodexPulseServer(REAL)).toBeNull();
  });
});

describe('codexMcpConflict', () => {
  it('flags shapes that already define our server, where a new header would be invalid TOML', () => {
    expect(codexMcpConflict('mcp_servers = { other = { command = "x" } }\n')).not.toBeNull();
    expect(codexMcpConflict('mcp_servers.agent-pulse.command = "x"\n')).not.toBeNull();
    expect(codexMcpConflict('[mcp_servers]\n"agent-pulse" = { command = "x" }\n')).not.toBeNull();
  });

  it('allows the normal sub-table layout and other servers', () => {
    expect(codexMcpConflict(REAL)).toBeNull();
    expect(codexMcpConflict(withCodexPulseServer(REAL, entry))).toBeNull();
    expect(codexMcpConflict('mcp_servers.other.command = "x"\n')).toBeNull();
    expect(codexMcpConflict('[mcp_servers]\nother = { command = "x" }\n')).toBeNull();
  });
});

describe('parseTableHeader', () => {
  it('parses dotted, quoted and spaced headers; rejects arrays of tables', () => {
    expect(parseTableHeader('[mcp_servers.agent-pulse]')).toEqual(['mcp_servers', 'agent-pulse']);
    expect(parseTableHeader(' [ mcp_servers . "agent-pulse" ] # x')).toEqual(['mcp_servers', 'agent-pulse']);
    expect(parseTableHeader("[projects.'E:\\a.b']")).toEqual(['projects', 'E:\\a.b']);
    expect(parseTableHeader('[[servers]]')).toBeNull();
    expect(parseTableHeader('key = 1')).toBeNull();
  });
});

describe('install / uninstall against a real CODEX_HOME', () => {
  let home: string;
  const prev = process.env.CODEX_HOME;
  const file = () => path.join(home, 'config.toml');

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-codex-'));
    process.env.CODEX_HOME = home;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes, reports current, backs up, and removes cleanly', () => {
    fs.writeFileSync(file(), REAL);
    expect(getCodexMcpStatus('C:\\pulse.exe')).toMatchObject({ detected: true, installed: false, current: false });

    expect(installCodexMcpServer('C:\\pulse.exe')).toEqual({ ok: true });
    const written = fs.readFileSync(file(), 'utf8');
    expect(written.startsWith(REAL)).toBe(true);
    expect(readCodexPulseServer(written)).toEqual({ command: 'C:\\pulse.exe', args: [serverScriptPath()] });
    expect(fs.readFileSync(`${file()}.agent-pulse-backup`, 'utf8')).toBe(REAL);
    expect(getCodexMcpStatus('C:\\pulse.exe')).toMatchObject({ installed: true, current: true });
    // Same build moved elsewhere → stale.
    expect(getCodexMcpStatus('D:\\pulse.exe')).toMatchObject({ installed: true, current: false });

    expect(uninstallCodexMcpServer()).toEqual({ ok: true });
    expect(fs.readFileSync(file(), 'utf8')).toBe(REAL);
  });

  it('creates config.toml when Codex is installed but has no config yet', () => {
    expect(installCodexMcpServer('C:\\pulse.exe')).toEqual({ ok: true });
    expect(readCodexPulseServer(fs.readFileSync(file(), 'utf8'))).not.toBeNull();
  });

  it('skips install when Codex is not on the machine', () => {
    process.env.CODEX_HOME = path.join(home, 'missing');
    expect(installCodexMcpServer('C:\\pulse.exe')).toEqual({ ok: true });
    expect(fs.existsSync(path.join(home, 'missing'))).toBe(false);
    expect(getCodexMcpStatus('C:\\pulse.exe')).toMatchObject({ detected: false, installed: false });
  });

  it('refuses to write when config.toml already defines agent-pulse another way', () => {
    const src = 'mcp_servers = { agent-pulse = { command = "x" } }\n';
    fs.writeFileSync(file(), src);
    expect(installCodexMcpServer('C:\\pulse.exe').ok).toBe(false);
    expect(fs.readFileSync(file(), 'utf8')).toBe(src);
  });
});
