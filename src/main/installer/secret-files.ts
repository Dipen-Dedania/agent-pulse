// Layer 1 — Secret Protection ignore-file fan-out.
//
// Translates the canonical secret-glob list into each detected agent's
// ignore/deny artifact, using a *managed block* (text files) or a *managed
// marker* (Claude settings.json) so we never clobber lines the user added by
// hand. Mirrors the non-clobbering merge style of config-writer.ts
// (writeClaudeCodeHook for JSON, enableCodexHooksFlag for TOML).
//
// Reversibility contract: a write replaces only our managed region; a remove
// strips only our region/entries. Writing twice with the same globs is stable
// (idempotent), which the tests assert.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId } from '../../common/types';
import { opencodeConfigDir } from './opencode-paths';

const BLOCK_START = '# >>> agent-pulse secret-protection (managed) >>>';
const BLOCK_END = '# <<< agent-pulse secret-protection (managed) <<<';

// Marker key in Claude settings.json recording exactly which deny entries we
// injected, so a later sync can retract entries the user removed from the list
// without touching deny rules the user added themselves.
const CLAUDE_MARKER_KEY = 'agentPulseManagedDeny';

export interface SecretFileResult {
  success: boolean;
  path?: string;
  // Why nothing was written, when applicable.
  skipped?: 'unsupported' | 'no-globs';
  format?: 'gitignore' | 'claude-json' | 'codex-toml' | 'opencode-json';
  // Globs that could not be expressed in the target's pattern dialect (e.g.
  // home-anchored globs for OpenCode's worktree-relative permission.read).
  skippedGlobs?: string[];
}

// ── Managed-block helpers (gitignore-style text files) ─────────────────────────

// Strip our managed block (markers inclusive) from text, leaving user lines and
// surrounding whitespace tidy. Tolerant of a partially-present block.
function stripManagedBlock(text: string): string {
  const startIdx = text.indexOf(BLOCK_START);
  if (startIdx === -1) return text;
  const endMarkerIdx = text.indexOf(BLOCK_END, startIdx);
  const endIdx = endMarkerIdx === -1 ? text.length : endMarkerIdx + BLOCK_END.length;
  const before = text.slice(0, startIdx).replace(/\n+$/, '');
  const after = text.slice(endIdx).replace(/^\n+/, '');
  if (!before) return after;
  if (!after) return before ? `${before}\n` : '';
  return `${before}\n${after}`;
}

function buildManagedBlock(lines: string[]): string {
  return [BLOCK_START, ...lines, BLOCK_END].join('\n');
}

// Write/refresh a managed block of gitignore-style globs into a text file,
// preserving everything outside the block. Empty globs → block removed.
function writeManagedText(filePath: string, globs: string[]): SecretFileResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = '';
  if (fs.existsSync(filePath)) {
    try { existing = fs.readFileSync(filePath, 'utf8'); } catch { existing = ''; }
  }
  const base = stripManagedBlock(existing);
  let next: string;
  if (globs.length === 0) {
    next = base;
  } else {
    const block = buildManagedBlock(globs);
    next = base.trim().length ? `${base.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;
  }
  fs.writeFileSync(filePath, next);
  return { success: true, path: filePath, format: 'gitignore' };
}

function removeManagedText(filePath: string): SecretFileResult {
  if (!fs.existsSync(filePath)) return { success: true, path: filePath };
  try {
    const stripped = stripManagedBlock(fs.readFileSync(filePath, 'utf8'));
    fs.writeFileSync(filePath, stripped);
  } catch { /* ignore */ }
  return { success: true, path: filePath };
}

// ── Claude Code — structured deny merge in settings.json ───────────────────────

// `.env` → `Read(./.env)`; `**/*.pem` → `Read(**/*.pem)`; `~/.ssh/**` →
// `Read(~/.ssh/**)`. Basename globs get a `./` anchor; anything with a path
// component (or a `~`) is passed through.
export function globToClaudeDeny(glob: string): string {
  const g = glob.trim();
  const hasPath = g.includes('/') || g.startsWith('~');
  return hasPath ? `Read(${g})` : `Read(./${g})`;
}

function writeClaudeDeny(globs: string[]): SecretFileResult {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  }
  settings.permissions = settings.permissions ?? {};
  const prevManaged: string[] = Array.isArray(settings[CLAUDE_MARKER_KEY]) ? settings[CLAUDE_MARKER_KEY] : [];
  const prevSet = new Set(prevManaged);

  const existingDeny: string[] = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  // Drop entries we previously managed, keep everything the user added.
  const userDeny = existingDeny.filter((e) => !prevSet.has(e));

  const ours = globs.map(globToClaudeDeny);
  // Dedupe against user entries so we don't double-list a rule the user also
  // wrote, and record what's ours for next time.
  const userSet = new Set(userDeny);
  const ourUnique = [...new Set(ours)].filter((e) => !userSet.has(e));

  settings.permissions.deny = [...userDeny, ...ourUnique];
  if (ourUnique.length) settings[CLAUDE_MARKER_KEY] = ourUnique;
  else delete settings[CLAUDE_MARKER_KEY];
  if (settings.permissions.deny.length === 0) delete settings.permissions.deny;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { success: true, path: settingsPath, format: 'claude-json' };
}

function removeClaudeDeny(): SecretFileResult {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return { success: true, path: settingsPath };
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const prevManaged: string[] = Array.isArray(settings[CLAUDE_MARKER_KEY]) ? settings[CLAUDE_MARKER_KEY] : [];
    if (prevManaged.length && Array.isArray(settings.permissions?.deny)) {
      const prevSet = new Set(prevManaged);
      settings.permissions.deny = settings.permissions.deny.filter((e: string) => !prevSet.has(e));
      if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
      if (settings.permissions && Object.keys(settings.permissions).length === 0) delete settings.permissions;
    }
    delete settings[CLAUDE_MARKER_KEY];
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch { /* ignore */ }
  return { success: true, path: settingsPath };
}

// ── Codex — managed region in config.toml ──────────────────────────────────────
// Codex enforces its own built-in OS-sandbox deny-read list (analysis §5.4); it
// has no public user key for additional deny-read globs. We therefore write a
// transparent, reversible *managed comment region* recording the protected
// globs (so the coverage is auditable in-file and removable on uninstall)
// rather than fabricating a key Codex doesn't read.
function writeCodexToml(globs: string[]): SecretFileResult {
  const tomlPath = path.join(os.homedir(), '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
  let content = '';
  if (fs.existsSync(tomlPath)) {
    try { content = fs.readFileSync(tomlPath, 'utf8'); } catch { content = ''; }
  }
  const base = stripManagedBlock(content);
  let next: string;
  if (globs.length === 0) {
    next = base;
  } else {
    const lines = [
      '# Protected secret globs (advisory — Codex enforces its own built-in sandbox deny-read list).',
      ...globs.map((g) => `# ${g}`),
    ];
    const block = buildManagedBlock(lines);
    next = base.trim().length ? `${base.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;
  }
  fs.writeFileSync(tomlPath, next);
  return { success: true, path: tomlPath, format: 'codex-toml' };
}

function removeCodexToml(): SecretFileResult {
  const tomlPath = path.join(os.homedir(), '.codex', 'config.toml');
  return removeManagedText(tomlPath);
}

// ── OpenCode — permission.read deny merge in opencode.json ─────────────────────
// OpenCode enforces read denies in core via `permission.read` — a map of
// wildcard patterns to 'allow' | 'ask' | 'deny'. Its dialect differs from our
// canonical .gitignore-style globs: there is NO `**`, a single `*` crosses `/`,
// evaluation is LAST-match-wins (fallback `ask`), and patterns are matched
// against worktree-relative paths. The managed-key marker lives in a sidecar
// file rather than inside opencode.json, which is schema-validated — an
// unknown top-level key risks boot warnings. OpenCode never reads the sidecar.

const OPENCODE_MARKER_FILENAME = 'agent-pulse-managed-read-deny.json';

/**
 * Translates one canonical .gitignore-style glob into OpenCode
 * `permission.read` pattern keys. Returns [] when the glob can't be expressed
 * (home-anchored / absolute paths — permission.read patterns are
 * worktree-relative; Layer 2 hook blocking still covers those reads).
 *
 * Our engine treats every glob as matching at any depth (basenames anywhere;
 * slash-globs as path suffixes — see secretProtection/engine.compileGlob), so
 * each pattern is emitted in a root form plus a star-slash-prefixed deeper
 * form, unless it already starts with `*` (which crosses `/` on its own).
 */
export function globToOpencodeDeny(glob: string): string[] {
  let g = glob.trim();
  if (!g) return [];
  if (g.startsWith('~') || g.startsWith('/') || /^[A-Za-z]:[\\/]/.test(g)) return [];
  if (g.startsWith('./')) g = g.slice(2);
  if (g.startsWith('**/')) g = g.slice(3);
  if (!g) return [];

  // Trailing `/**` (everything under a dir): one star suffices — it crosses `/`.
  g = g.replace(/\/\*\*$/, '/*');

  // Interior `/**/`: gitignore's `**` matches zero directories too, so emit
  // both the collapsed form and a one-star form (which still crosses `/`).
  const variants = /\/\*\*\//.test(g)
    ? [g.replace(/\/\*\*\//g, '/'), g.replace(/\/\*\*\//g, '/*/')]
    : [g];

  const out: string[] = [];
  for (const v of variants) {
    if (!v) continue;
    out.push(v);
    if (!v.startsWith('*')) out.push(`*/${v}`);
  }
  return [...new Set(out)];
}

function readOpencodeMarker(markerPath: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeOpencodeDeny(globs: string[]): SecretFileResult {
  const dir = opencodeConfigDir();
  const configPath = path.join(dir, 'opencode.json');
  const markerPath = path.join(dir, OPENCODE_MARKER_FILENAME);
  fs.mkdirSync(dir, { recursive: true });

  let config: any = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // Unparseable (possibly jsonc with comments) — never risk clobbering.
      return { success: false, path: configPath, format: 'opencode-json' };
    }
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { success: false, path: configPath, format: 'opencode-json' };
  }

  const skippedGlobs: string[] = [];
  const ourKeys: string[] = [];
  for (const g of globs) {
    const translated = globToOpencodeDeny(g);
    if (translated.length === 0) skippedGlobs.push(g);
    else ourKeys.push(...translated);
  }
  const ourSet = new Set(ourKeys);
  const prevSet = new Set(readOpencodeMarker(markerPath));

  config.permission =
    config.permission && typeof config.permission === 'object' && !Array.isArray(config.permission)
      ? config.permission
      : {};
  const existingRead = config.permission.read;
  // A bare string is OpenCode shorthand for { '*': action } — normalize so the
  // user's global choice survives the merge.
  const userEntries: [string, unknown][] =
    typeof existingRead === 'string'
      ? [['*', existingRead]]
      : existingRead && typeof existingRead === 'object' && !Array.isArray(existingRead)
        ? Object.entries(existingRead)
        : [];

  // Rebuild with user keys first (original order) and ours appended LAST:
  // evaluation is last-match-wins, and the feature's contract is that a
  // protected glob stays denied while its rule is enabled — an earlier user
  // `"*": "allow"` must not silently void it. A user entry for the exact same
  // key is dropped (a JSON object can't hold it twice, and keeping it in its
  // earlier position would let it win); the escape hatch is disabling the rule
  // in Agent Pulse, which retracts our key on the next sync.
  const read: Record<string, unknown> = {};
  for (const [k, v] of userEntries) {
    if (prevSet.has(k)) continue; // previously ours — retract; re-added below if still wanted
    if (ourSet.has(k)) continue;
    read[k] = v;
  }
  for (const k of ourSet) read[k] = 'deny';

  if (Object.keys(read).length > 0) config.permission.read = read;
  else delete config.permission.read;
  if (Object.keys(config.permission).length === 0) delete config.permission;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  if (ourSet.size > 0) fs.writeFileSync(markerPath, JSON.stringify([...ourSet], null, 2));
  else { try { fs.unlinkSync(markerPath); } catch { /* ignore */ } }

  return {
    success: true,
    path: configPath,
    format: 'opencode-json',
    ...(skippedGlobs.length ? { skippedGlobs } : {}),
  };
}

function removeOpencodeDeny(): SecretFileResult {
  const dir = opencodeConfigDir();
  const configPath = path.join(dir, 'opencode.json');
  const markerPath = path.join(dir, OPENCODE_MARKER_FILENAME);
  const prevManaged = readOpencodeMarker(markerPath);
  if (prevManaged.length && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const read = config?.permission?.read;
      if (read && typeof read === 'object' && !Array.isArray(read)) {
        for (const k of prevManaged) delete read[k];
        if (Object.keys(read).length === 0) delete config.permission.read;
        if (config.permission && Object.keys(config.permission).length === 0) delete config.permission;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    } catch { /* unparseable — leave the user's file alone */ }
  }
  try { fs.unlinkSync(markerPath); } catch { /* ignore */ }
  return { success: true, path: configPath };
}

// ── Per-tool artifact resolution ────────────────────────────────────────────────
// Resolves the gitignore-style ignore file for tools that use one. Returns null
// for tools handled by a structured writer (claude/codex) or unsupported (kiro).
function ignoreFilePathFor(toolId: ToolId, projectPath?: string): string | null {
  const home = os.homedir();
  switch (toolId) {
    case 'cursor':
      return projectPath ? path.join(projectPath, '.cursorignore') : path.join(home, '.cursorignore');
    case 'vscode-copilot':
      return projectPath ? path.join(projectPath, '.copilotignore') : path.join(home, '.copilotignore');
    case 'antigravity-cli':
      return projectPath ? path.join(projectPath, '.geminiignore') : path.join(home, '.geminiignore');
    default:
      return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

export function writeSecretFilesForTool(
  toolId: ToolId,
  globs: string[],
  opts: { projectPath?: string } = {},
): SecretFileResult {
  if (globs.length === 0) {
    // Treat an empty list as a removal so disabling every rule cleans up.
    return removeSecretFilesForTool(toolId, opts);
  }
  switch (toolId) {
    case 'claude-code':
      return writeClaudeDeny(globs);
    case 'openai-codex':
      return writeCodexToml(globs);
    case 'opencode':
      return writeOpencodeDeny(globs);
    case 'kiro':
      return { success: true, skipped: 'unsupported' };
    default: {
      const filePath = ignoreFilePathFor(toolId, opts.projectPath);
      if (!filePath) return { success: true, skipped: 'unsupported' };
      return writeManagedText(filePath, globs);
    }
  }
}

// ── Phase 4 — emerging cross-agent standard (.aiignore) ─────────────────────────
// Tool-agnostic: a single managed-block file that the proposed `.aiignore`
// standard (gemini-cli #4688) would have every agent read. Harmless where
// unsupported, future-proofing where it lands. Global → ~/.aiignore.
export function writeAiIgnore(globs: string[], opts: { projectPath?: string } = {}): SecretFileResult {
  const filePath = opts.projectPath
    ? path.join(opts.projectPath, '.aiignore')
    : path.join(os.homedir(), '.aiignore');
  if (globs.length === 0) return removeManagedText(filePath);
  return writeManagedText(filePath, globs);
}

export function removeAiIgnore(opts: { projectPath?: string } = {}): SecretFileResult {
  const filePath = opts.projectPath
    ? path.join(opts.projectPath, '.aiignore')
    : path.join(os.homedir(), '.aiignore');
  return removeManagedText(filePath);
}

export function removeSecretFilesForTool(
  toolId: ToolId,
  opts: { projectPath?: string } = {},
): SecretFileResult {
  switch (toolId) {
    case 'claude-code':
      return removeClaudeDeny();
    case 'openai-codex':
      return removeCodexToml();
    case 'opencode':
      return removeOpencodeDeny();
    case 'kiro':
      return { success: true, skipped: 'unsupported' };
    default: {
      const filePath = ignoreFilePathFor(toolId, opts.projectPath);
      if (!filePath) return { success: true, skipped: 'unsupported' };
      return removeManagedText(filePath);
    }
  }
}
