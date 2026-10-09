// Register the Agent Pulse MCP server with Claude Code, user-wide.
//
// Claude Code keeps user-scope MCP servers in `~/.claude.json` under a
// top-level `mcpServers` map (project scope lives in a repo's `.mcp.json`,
// local scope under `projects[cwd].mcpServers`). User scope is what makes
// backlog capture work from a chat in ANY repo, which is the point.
//
// The server is launched through our own binary with ELECTRON_RUN_AS_NODE=1
// rather than a bare `node`: a packaged install can't assume node is on PATH,
// and Electron in node mode reads the script out of app.asar happily.
//
// The write is read-modify-write on a file Claude Code also owns, so it is
// atomic (tmp + rename) and takes a one-time backup. A Claude Code session
// that is already open holds this config in memory — the UI tells the user to
// start a new session, which is also when a newly registered server is picked up.
//
// The same entry goes to Codex CLI as a `[mcp_servers.agent-pulse]` table in
// $CODEX_HOME/config.toml, but only when Codex is on the machine (its home dir
// exists). One Connect keeps both clients in sync; status is per client.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { codexHome } from '../backlog/codex-settings';
import {
  findKeyInSpan,
  findTable,
  findTablesUnder,
  parseTomlString,
  parseTomlStringArray,
  removeTable,
  splitLines,
  tomlString,
  upsertTable,
} from '../installer/codex-toml';

export const MCP_SERVER_KEY = 'agent-pulse';

export interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpInstallStatus {
  /** An entry under our key exists in ~/.claude.json. */
  installed: boolean;
  /** It exists AND points at this build's binary + script (stale after a move/update). */
  current: boolean;
  configPath: string;
  scriptPath: string;
  /** Present when the config file exists but could not be read/parsed. */
  error?: string;
  codex: CodexMcpStatus;
}

export interface CodexMcpStatus {
  /** $CODEX_HOME exists — we only register with a Codex that is installed. */
  detected: boolean;
  /** A [mcp_servers.agent-pulse] table exists in config.toml. */
  installed: boolean;
  /** It exists AND points at this build's binary + script. */
  current: boolean;
  configPath: string;
  /** Present when config.toml could not be read or cannot take our table. */
  error?: string;
}

type WriteResult = { ok: true } | { ok: false; reason: string };

export function claudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** Absolute path of the compiled stdio server that ships beside this module. */
export function serverScriptPath(): string {
  return path.join(__dirname, 'server.js');
}

export function buildMcpEntry(execPath: string, scriptPath: string): McpServerEntry {
  return {
    type: 'stdio',
    command: execPath,
    args: [scriptPath],
    // Runs our binary as plain Node so it executes the script instead of
    // booting a second copy of the app.
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/** Same binary, same script — anything else is stale and should be re-registered. */
export function entryMatches(existing: unknown, expected: McpServerEntry): boolean {
  const e = existing as McpServerEntry | undefined;
  return !!e
    && e.command === expected.command
    && Array.isArray(e.args)
    && e.args.length === expected.args.length
    && e.args.every((a, i) => a === expected.args[i]);
}

/** Pure merge: config + entry → new config. Never mutates the input. */
export function withPulseServer(config: any, entry: McpServerEntry): any {
  const base = config && typeof config === 'object' ? config : {};
  const servers = base.mcpServers && typeof base.mcpServers === 'object' ? base.mcpServers : {};
  return { ...base, mcpServers: { ...servers, [MCP_SERVER_KEY]: entry } };
}

/** Pure removal: strips only our key, leaving every other server untouched. */
export function withoutPulseServer(config: any): any {
  const base = config && typeof config === 'object' ? config : {};
  if (!base.mcpServers || typeof base.mcpServers !== 'object') return base;
  const { [MCP_SERVER_KEY]: _removed, ...rest } = base.mcpServers;
  return { ...base, mcpServers: rest };
}

function readConfig(): { ok: true; config: any; existed: boolean } | { ok: false; reason: string } {
  const file = claudeConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e: any) {
    // No file yet (Claude Code never run, or a fresh machine) — start from empty.
    if (e?.code === 'ENOENT') return { ok: true, config: {}, existed: false };
    return { ok: false, reason: `could not read ${file}: ${e?.message ?? e}` };
  }
  try {
    return { ok: true, config: JSON.parse(raw), existed: true };
  } catch (e: any) {
    // Refuse to overwrite a file we can't parse — that would destroy the
    // user's Claude Code state.
    return { ok: false, reason: `${file} is not valid JSON (${e?.message ?? e}) — fix it before connecting` };
  }
}

function writeConfig(config: any, backup: boolean): WriteResult {
  return writeAtomic(claudeConfigPath(), `${JSON.stringify(config, null, 2)}\n`, backup);
}

function writeAtomic(file: string, text: string, backup: boolean): WriteResult {
  const tmp = `${file}.agent-pulse.tmp`;
  try {
    if (backup) {
      try {
        fs.copyFileSync(file, `${file}.agent-pulse-backup`);
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e; // nothing to back up on a fresh machine
      }
    }
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file); // atomic on the same filesystem
    return { ok: true };
  } catch (e: any) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    return { ok: false, reason: `could not write ${file}: ${e?.message ?? e}` };
  }
}

export function getMcpInstallStatus(execPath: string = process.execPath): McpInstallStatus {
  const scriptPath = serverScriptPath();
  const expected = buildMcpEntry(execPath, scriptPath);
  const codex = getCodexMcpStatus(execPath);
  const read = readConfig();
  if (!read.ok) {
    return { installed: false, current: false, configPath: claudeConfigPath(), scriptPath, error: read.reason, codex };
  }
  const existing = read.config?.mcpServers?.[MCP_SERVER_KEY];
  return {
    installed: !!existing,
    current: entryMatches(existing, expected),
    configPath: claudeConfigPath(),
    scriptPath,
    codex,
  };
}

/** Registers with Claude Code and, when present, Codex. Fails if either does. */
export function installMcpServer(execPath: string = process.execPath): { ok: boolean; reason?: string } {
  return combineResults(installClaudeMcpServer(execPath), installCodexMcpServer(execPath));
}

export function uninstallMcpServer(): { ok: boolean; reason?: string } {
  return combineResults(uninstallClaudeMcpServer(), uninstallCodexMcpServer());
}

function combineResults(claude: WriteResult, codex: WriteResult): { ok: boolean; reason?: string } {
  const reasons = [
    claude.ok ? null : `Claude Code: ${claude.reason}`,
    codex.ok ? null : `Codex: ${codex.reason}`,
  ].filter((r): r is string => r !== null);
  return reasons.length === 0 ? { ok: true } : { ok: false, reason: reasons.join(' · ') };
}

export function installClaudeMcpServer(execPath: string = process.execPath): WriteResult {
  const read = readConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  const entry = buildMcpEntry(execPath, serverScriptPath());
  if (entryMatches(read.config?.mcpServers?.[MCP_SERVER_KEY], entry)) return { ok: true };
  return writeConfig(withPulseServer(read.config, entry), read.existed);
}

export function uninstallClaudeMcpServer(): WriteResult {
  const read = readConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  if (!read.config?.mcpServers?.[MCP_SERVER_KEY]) return { ok: true };
  return writeConfig(withoutPulseServer(read.config), read.existed);
}

// ── Codex CLI ────────────────────────────────────────────────────────────────
// Codex reads stdio servers from `[mcp_servers.<name>]` tables (command, args,
// env) and, like Claude Code, only at session start. config.toml is hand-edited
// by users and rewritten by Codex itself, so we edit it line-wise
// (../installer/codex-toml.ts): our table is replaced or removed and every
// other line survives byte for byte.

export const CODEX_TABLE_PATH = ['mcp_servers', MCP_SERVER_KEY];

export function codexMcpConfigPath(): string {
  return path.join(codexHome(), 'config.toml');
}

export function codexDetected(): boolean {
  try {
    return fs.statSync(codexHome()).isDirectory();
  } catch {
    return false;
  }
}

/** The `key = value` lines of our table, in the shape Codex documents. */
export function codexTableBody(entry: McpServerEntry): string[] {
  const env = Object.entries(entry.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ');
  return [
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(', ')}]`,
    `env = { ${env} }`,
  ];
}

/** Pure: config.toml text + entry → new text with our table written. */
export function withCodexPulseServer(content: string, entry: McpServerEntry): string {
  return upsertTable(content, CODEX_TABLE_PATH, codexTableBody(entry));
}

/** Pure: strips our table (and any sub-tables of it) only. */
export function withoutCodexPulseServer(content: string): string {
  return removeTable(content, CODEX_TABLE_PATH);
}

/** command/args of our table as written, or null when there is no table. */
export function readCodexPulseServer(content: string): { command: string | null; args: string[] | null } | null {
  const { lines } = splitLines(content);
  const span = findTablesUnder(lines, CODEX_TABLE_PATH).find((s) => s.exact);
  if (!span) return null;
  const command = findKeyInSpan(lines, span, 'command');
  const args = findKeyInSpan(lines, span, 'args');
  return {
    command: command ? parseTomlString(command.valueText) : null,
    args: args ? parseTomlStringArray(args.valueText) : null,
  };
}

/**
 * Shapes that already define our server some other way, so adding a
 * `[mcp_servers.agent-pulse]` header would be a duplicate-table error and
 * Codex would refuse to load config.toml at all: an inline `mcp_servers = {…}`
 * or a dotted `agent-pulse…` key at the root or inside `[mcp_servers]`.
 */
export function codexMcpConflict(content: string): string | null {
  const { lines } = splitLines(content);
  const ours = `["']?${MCP_SERVER_KEY}["']?\\s*[.=]`;
  const rootInline = /^\s*mcp_servers\s*=\s*\{/;
  const rootDotted = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${ours}`);
  for (const l of lines) {
    if (/^\s*\[/.test(l)) break; // root scope ends at the first header
    if (rootInline.test(l) || rootDotted.test(l)) {
      return 'config.toml defines mcp_servers with dotted keys or an inline table — add agent-pulse by hand';
    }
  }
  const tbl = findTable(lines, 'mcp_servers');
  if (tbl) {
    const inTable = new RegExp(`^\\s*${ours}`);
    for (let i = tbl.header + 1; i <= tbl.end; i++) {
      if (inTable.test(lines[i])) {
        return 'config.toml defines agent-pulse inside [mcp_servers] — remove that entry, then connect again';
      }
    }
  }
  return null;
}

function readCodexConfig(): { ok: true; content: string; existed: boolean } | { ok: false; reason: string } {
  const file = codexMcpConfigPath();
  try {
    return { ok: true, content: fs.readFileSync(file, 'utf8'), existed: true };
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { ok: true, content: '', existed: false };
    return { ok: false, reason: `could not read ${file}: ${e?.message ?? e}` };
  }
}

export function getCodexMcpStatus(execPath: string = process.execPath): CodexMcpStatus {
  const configPath = codexMcpConfigPath();
  const detected = codexDetected();
  const read = readCodexConfig();
  if (!read.ok) return { detected, installed: false, current: false, configPath, error: read.reason };
  const existing = readCodexPulseServer(read.content);
  const conflict = existing ? null : codexMcpConflict(read.content);
  const expected = buildMcpEntry(execPath, serverScriptPath());
  return {
    detected,
    installed: !!existing,
    current: !!existing && entryMatches(existing, expected),
    configPath,
    ...(conflict ? { error: conflict } : {}),
  };
}

export function installCodexMcpServer(execPath: string = process.execPath): WriteResult {
  if (!codexDetected()) return { ok: true }; // no Codex here — nothing to register with
  const read = readCodexConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  const conflict = codexMcpConflict(read.content);
  if (conflict) return { ok: false, reason: conflict };
  const next = withCodexPulseServer(read.content, buildMcpEntry(execPath, serverScriptPath()));
  if (next === read.content) return { ok: true };
  return writeAtomic(codexMcpConfigPath(), next, read.existed);
}

export function uninstallCodexMcpServer(): WriteResult {
  const read = readCodexConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  const next = withoutCodexPulseServer(read.content);
  if (next === read.content) return { ok: true };
  return writeAtomic(codexMcpConfigPath(), next, read.existed);
}
