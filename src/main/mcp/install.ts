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

import fs from 'fs';
import os from 'os';
import path from 'path';

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
}

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

function writeConfig(config: any, backup: boolean): { ok: true } | { ok: false; reason: string } {
  const file = claudeConfigPath();
  const tmp = `${file}.agent-pulse.tmp`;
  try {
    if (backup) {
      try {
        fs.copyFileSync(file, `${file}.agent-pulse-backup`);
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e; // nothing to back up on a fresh machine
      }
    }
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
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
  const read = readConfig();
  if (!read.ok) {
    return { installed: false, current: false, configPath: claudeConfigPath(), scriptPath, error: read.reason };
  }
  const existing = read.config?.mcpServers?.[MCP_SERVER_KEY];
  return {
    installed: !!existing,
    current: entryMatches(existing, expected),
    configPath: claudeConfigPath(),
    scriptPath,
  };
}

export function installMcpServer(execPath: string = process.execPath): { ok: boolean; reason?: string } {
  const read = readConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  const entry = buildMcpEntry(execPath, serverScriptPath());
  if (entryMatches(read.config?.mcpServers?.[MCP_SERVER_KEY], entry)) return { ok: true };
  return writeConfig(withPulseServer(read.config, entry), read.existed);
}

export function uninstallMcpServer(): { ok: boolean; reason?: string } {
  const read = readConfig();
  if (!read.ok) return { ok: false, reason: read.reason };
  if (!read.config?.mcpServers?.[MCP_SERVER_KEY]) return { ok: true };
  return writeConfig(withoutPulseServer(read.config), read.existed);
}
