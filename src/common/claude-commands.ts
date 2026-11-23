// Claude Code slash-command registry. Pure: no fs, no Electron, so the main
// process and the renderer classify a name the same way.
//
// Only raw names are stored (see command-history.ts); everything here runs at
// query time, so a skill installed later reclassifies old history.

export type CommandKind = 'core' | 'bundled-skill' | 'removed';
export type CommandCategory = 'builtin' | 'custom' | 'plugin' | 'unknown';
// Where a command found on disk came from: the user's own folders, or an
// installed plugin.
export type DiscoveredSource = 'custom' | 'plugin';

interface BuiltinDef { aliases?: string[]; kind?: CommandKind }

// From https://code.claude.com/docs/en/commands.md, read 2026-11-23. Kept by
// hand, so it lags behind Claude Code releases: a name missing here shows as
// "Other", never as an error. Removed commands stay listed so old history is
// not mistaken for typos.
const BUILTINS: Record<string, BuiltinDef> = {
  'add-dir': {}, advisor: {}, agents: {}, artifacts: {}, 'auto-mode-setup': {}, autocompact: {},
  'autofix-pr': {}, background: { aliases: ['bg'] }, branch: {}, btw: {}, bug: { aliases: ['share'] },
  cd: {}, chrome: {}, clear: { aliases: ['reset', 'new'] }, color: {}, compact: {},
  config: { aliases: ['settings'] }, context: {}, copy: {}, 'deep-research': {}, 'design-login': {},
  desktop: { aliases: ['app'] }, diff: {}, effort: {}, exit: { aliases: ['quit'] }, export: {}, fast: {},
  feedback: {}, focus: {}, fork: {}, goal: {}, heapdump: {}, help: {}, hooks: {}, ide: {}, import: {},
  init: {}, insights: {}, 'install-github-app': {}, 'install-slack-app': {}, keybindings: {},
  'list-agents': { aliases: ['peers'] }, login: {}, logout: {}, mcp: {}, memory: {},
  mobile: { aliases: ['ios', 'android'] }, model: {}, 'output-style': {}, passes: {},
  permissions: { aliases: ['allowed-tools'] }, plan: {}, plugin: {}, powerup: {}, 'privacy-settings': {},
  radio: {}, 'rate-limit-options': {}, recap: {}, 'release-notes': {}, 'reload-plugins': {},
  'reload-skills': {}, 'remote-control': { aliases: ['rc'] }, 'remote-env': {}, rename: {},
  restart: { aliases: ['update'] }, resume: { aliases: ['continue'] },
  rewind: { aliases: ['checkpoint', 'undo'] }, sandbox: {}, schedule: { aliases: ['routines'] },
  'scroll-speed': {}, 'security-review': {}, 'setup-bedrock': {}, 'setup-vertex': {}, 'skill-doctor': {},
  skills: {}, status: {}, statusline: {}, stickers: {}, stop: {}, subtask: {}, tasks: { aliases: ['bashes'] },
  'team-onboarding': {}, teleport: { aliases: ['tp'] }, 'terminal-setup': {}, theme: {}, tui: {},
  ultrareview: {}, upgrade: {}, usage: { aliases: ['cost', 'stats'] },
  'usage-credits': { aliases: ['extra-usage'] }, voice: {}, 'web-setup': {}, workflows: {},

  // Bundled skills. A user skill of the same name replaces one of these.
  'artifact-capabilities': { kind: 'bundled-skill' }, 'artifact-diagramming': { kind: 'bundled-skill' },
  batch: { kind: 'bundled-skill' }, 'claude-api': { kind: 'bundled-skill' },
  'claude-in-chrome': { kind: 'bundled-skill' }, 'code-review': { kind: 'bundled-skill', aliases: ['review'] },
  dataviz: { kind: 'bundled-skill' }, debug: { kind: 'bundled-skill' }, design: { kind: 'bundled-skill' },
  'design-sync': { kind: 'bundled-skill' }, doctor: { kind: 'bundled-skill', aliases: ['checkup'] },
  'fewer-permission-prompts': { kind: 'bundled-skill' }, loop: { kind: 'bundled-skill', aliases: ['proactive'] },
  'plugin-authoring': { kind: 'bundled-skill' }, run: { kind: 'bundled-skill' },
  'run-skill-generator': { kind: 'bundled-skill' }, simplify: { kind: 'bundled-skill' },
  slides: { kind: 'bundled-skill' }, 'update-config': { kind: 'bundled-skill' }, verify: { kind: 'bundled-skill' },
  'workflow-authoring': { kind: 'bundled-skill' },

  // Removed from Claude Code.
  'pr-comments': { kind: 'removed' }, ultraplan: { kind: 'removed' }, vim: { kind: 'removed' },
};

export const BUILTIN_COMMANDS: ReadonlyMap<string, { aliases: readonly string[]; kind: CommandKind }> = new Map(
  Object.entries(BUILTINS).map(([name, def]) => [name, { aliases: def.aliases ?? [], kind: def.kind ?? 'core' }]),
);

const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  Object.entries(BUILTINS).flatMap(([name, def]) => (def.aliases ?? []).map((a) => [a, name] as [string, string])),
);

// Built-ins worth pointing out to someone who has never run them.
export const DISCOVERY_COMMANDS: readonly string[] = ['context', 'rewind'];

// A command name as Claude Code accepts it. `/Users/x` and `/tmp/foo` fail
// because the caller also requires whitespace or the end of the text after it.
const NAME_RE = /^[A-Za-z][\w:.-]{0,63}$/;

export function isCommandName(name: string): boolean {
  return NAME_RE.test(name);
}

/** Folds an alias into its main command (`new` → `clear`). */
export function canonicalCommand(name: string): string {
  return ALIAS_TO_CANONICAL.get(name) ?? name;
}

function isPluginShaped(name: string): boolean {
  return name.includes(':') || name.startsWith('mcp__');
}

/**
 * Category of a command name. `discovered` holds the commands and skills found
 * on disk. A core built-in always wins; a user skill replaces a bundled skill
 * of the same name (documented); plugin and MCP commands share one category
 * because MCP prompts also appear as `server:prompt`.
 */
export function classifyCommand(
  name: string,
  discovered: ReadonlyMap<string, DiscoveredSource> = new Map(),
): CommandCategory {
  const canonical = canonicalCommand(name);
  const builtin = BUILTIN_COMMANDS.get(canonical);
  if (builtin && builtin.kind !== 'bundled-skill') return 'builtin';
  const found = discovered.get(name);
  if (found === 'custom') return 'custom';
  if (builtin) return 'builtin';
  if (found === 'plugin' || isPluginShaped(name)) return 'plugin';
  return 'unknown';
}

/**
 * Whether a mid-prompt mention of `name` counts. Only the user's own commands
 * and plugin commands do: "fix the /login route" is prose, not a command.
 */
export function countsInline(name: string, discovered: ReadonlyMap<string, DiscoveredSource>): boolean {
  const category = classifyCommand(name, discovered);
  return category === 'custom' || category === 'plugin';
}

// Damerau-Levenshtein (optimal string alignment): a swapped pair of letters
// costs 1, so `claer` is 1 away from `clear`.
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * The known command `name` was most likely meant to be, or null. The nearest
 * candidate wins, up to distance 2; names of one or two characters allow only
 * distance 1, since at 2 they match almost anything. Short names tie often
 * (`nre` is 2 away from `new`, `rc` and `ide`), so ties go to the command the
 * user runs most (`usage`, by raw name), then to one with the same first
 * letter, then to the alphabetically first.
 */
export function suggestCommand(
  name: string,
  discovered: ReadonlyMap<string, DiscoveredSource> = new Map(),
  usage: ReadonlyMap<string, number> = new Map(),
): string | null {
  if (isPluginShaped(name)) return null;
  const maxDistance = name.length <= 2 ? 1 : 2;
  const candidates = new Set<string>([...BUILTIN_COMMANDS.keys(), ...ALIAS_TO_CANONICAL.keys(), ...discovered.keys()]);
  let best: { name: string; distance: number; used: number; sameStart: boolean } | null = null;
  for (const candidate of candidates) {
    if (candidate === name || isPluginShaped(candidate)) continue;
    if (BUILTIN_COMMANDS.get(candidate)?.kind === 'removed') continue;
    if (Math.abs(candidate.length - name.length) > maxDistance) continue;
    const distance = editDistance(name, candidate);
    if (distance > maxDistance) continue;
    const next = { name: candidate, distance, used: usage.get(candidate) ?? 0, sameStart: candidate[0] === name[0] };
    const wins = best === null
      || next.distance < best.distance
      || (next.distance === best.distance && (
        next.used > best.used
        || (next.used === best.used && next.sameStart && !best.sameStart)
        || (next.used === best.used && next.sameStart === best.sameStart && next.name < best.name)
      ));
    if (wins) best = next;
  }
  return best ? best.name : null;
}
