// Built-in guardrail rules — safe defaults.
//
// Each rule has an id, regex pattern, OS scope, tier (mustBlock | warn), and
// human-readable message. The engine matches against the raw command string
// using the regex; flags default to case-insensitive.
//
// HOW TO ADD A NEW RULE
//   1. Append an object to CORE_RULES below.
//   2. Use a unique id (kebab-case).
//   3. Make `os` as narrow as possible to avoid false positives.
//   4. Prefer specific anchors (`\b`, `^`, `$`) over greedy patterns.
//   5. Test it in src/main/guardrails/__tests__/engine.test.ts.

import { GuardrailRule } from '../../common/guardrails';

export const CORE_RULES: GuardrailRule[] = [
  // ── Tier 1: MUST BLOCK ────────────────────────────────────────────────────

  {
    id: 'rm-rf-root',
    pattern: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+(?:\/|\/\*|~|\$HOME)(?:\s|$)/i,
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: "`rm -rf /` (or equivalent) will wipe the root filesystem.",
    suggestedFix: 'Target a specific subdirectory and double-check the path before running.',
    source: 'core',
  },
  {
    id: 'del-system-root',
    pattern: /\b(?:rmdir|rd|del|erase)\s+\/[sq]\b.*?(?:C:\\|%SystemRoot%|%WINDIR%|%ProgramFiles%)/i,
    os: ['win'],
    tier: 'mustBlock',
    message: 'Recursive delete targeting a system path will brick Windows.',
    suggestedFix: 'Use a scoped path under your user directory.',
    source: 'core',
  },
  {
    id: 'format-disk-windows',
    pattern: /\bformat\s+[a-z]:/i,
    os: ['win'],
    tier: 'mustBlock',
    message: 'Formatting a drive erases all data on it.',
    source: 'core',
  },
  {
    id: 'mkfs-disk',
    pattern: /\bmkfs(?:\.\w+)?\s+\/dev\//i,
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: 'mkfs against a device path will reformat the disk and destroy data.',
    source: 'core',
  },
  {
    id: 'dd-to-disk',
    pattern: /\bdd\s+.*\bof=\/dev\/(?:sd|nvme|disk|hd)/i,
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: '`dd` writing directly to a disk device will overwrite raw sectors.',
    suggestedFix: 'Double-check `of=` is a regular file, not a block device.',
    source: 'core',
  },
  {
    id: 'pipe-to-shell',
    pattern: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|cmd)\b/i,
    os: ['all'],
    tier: 'mustBlock',
    message: 'Piping remote content directly into a shell executes untrusted code.',
    suggestedFix: 'Download the script first, inspect it, then run it explicitly.',
    source: 'core',
  },
  {
    id: 'chmod-recursive-root',
    pattern: /\bchmod\s+-R\s+\d+\s+\/(?:\s|$)/i,
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: 'Recursive chmod on `/` will break system permissions everywhere.',
    source: 'core',
  },
  {
    id: 'git-clean-fdx',
    pattern: /\bgit\s+clean\s+(?:-[a-z]*[fdx][a-z]*){1,3}/i,
    os: ['all'],
    tier: 'mustBlock',
    message: '`git clean -fdx` permanently deletes all untracked files (including .env / build artifacts).',
    suggestedFix: 'Run with `--dry-run` first, or target specific paths.',
    source: 'core',
  },
  {
    id: 'fork-bomb',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    flags: '',
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: 'Classic fork bomb — will exhaust process table.',
    source: 'core',
  },
  {
    id: 'shutdown-poweroff',
    pattern: /\b(?:shutdown(?:\s+\/s)?|poweroff|halt|init\s+0)\b/i,
    os: ['all'],
    tier: 'mustBlock',
    message: 'Powers off / halts the machine.',
    suggestedFix: 'Run shutdown manually if that is genuinely what you intend.',
    source: 'core',
  },
  {
    id: 'disable-firewall-windows',
    pattern: /\bnetsh\s+advfirewall\s+set\s+\w+profile\s+state\s+off/i,
    os: ['win'],
    tier: 'mustBlock',
    message: 'Disables the Windows firewall.',
    source: 'core',
  },
  {
    id: 'disable-firewall-unix',
    pattern: /\b(?:ufw\s+disable|pfctl\s+-d|systemctl\s+(?:stop|disable)\s+(?:ufw|firewalld))\b/i,
    os: ['mac', 'linux'],
    tier: 'mustBlock',
    message: 'Disables the host firewall.',
    source: 'core',
  },
  {
    id: 'drop-database',
    pattern: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i,
    os: ['all'],
    tier: 'mustBlock',
    message: 'Dropping a database/schema is irreversible.',
    suggestedFix: 'Take a backup, then run interactively in a SQL client.',
    source: 'core',
  },

  // ── Tier 2: WARN ──────────────────────────────────────────────────────────

  {
    id: 'git-reset-hard',
    pattern: /\bgit\s+reset\s+--hard\b/i,
    os: ['all'],
    tier: 'warn',
    message: '`git reset --hard` discards uncommitted changes.',
    suggestedFix: 'Stash first (`git stash`) if you might want the changes back.',
    source: 'core',
  },
  {
    id: 'git-push-force',
    // Allow --force-with-lease; flag bare --force / -f
    pattern: /\bgit\s+push\b(?=[^|;&]*\s(?:--force\b(?!-with-lease)|-f\b))/i,
    os: ['all'],
    tier: 'warn',
    message: '`git push --force` can overwrite remote history for others.',
    suggestedFix: 'Use `--force-with-lease` to refuse the push if upstream changed.',
    source: 'core',
  },
  {
    id: 'git-checkout-discard',
    pattern: /\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.\s*$/i,
    os: ['all'],
    tier: 'warn',
    message: 'Discards all uncommitted changes in the working tree.',
    source: 'core',
  },
  {
    id: 'git-amend',
    pattern: /\bgit\s+commit\s+(?:[^|;&]*\s)?--amend\b/i,
    os: ['all'],
    tier: 'warn',
    message: 'Amending a commit that was already pushed rewrites history.',
    source: 'core',
  },
  {
    id: 'git-rebase-mainline',
    pattern: /\bgit\s+rebase\b[^|;&]*\b(?:main|master|develop)\b/i,
    os: ['all'],
    tier: 'warn',
    message: 'Rebasing onto / across a shared mainline branch can rewrite history that others depend on.',
    source: 'core',
  },
  {
    id: 'no-verify',
    pattern: /\bgit\s+(?:commit|push)\b[^|;&]*--no-verify\b/i,
    os: ['all'],
    tier: 'warn',
    message: '`--no-verify` skips pre-commit / pre-push hooks (linters, tests, signing).',
    source: 'core',
  },
  {
    id: 'sudo-rm',
    pattern: /\bsudo\s+rm\b/i,
    os: ['mac', 'linux'],
    tier: 'warn',
    message: '`sudo rm` runs with elevated privileges — mistakes are unrecoverable.',
    source: 'core',
  },
  {
    id: 'chmod-777',
    pattern: /\bchmod\s+(?:-R\s+)?777\b/i,
    os: ['mac', 'linux'],
    tier: 'warn',
    message: 'chmod 777 gives world write/execute — almost never what you want.',
    source: 'core',
  },
  {
    id: 'env-overwrite',
    pattern: /(?:^|[|;&])\s*[^<>]*?>\s*\.env(?:\.\w+)?\b/i,
    os: ['all'],
    tier: 'warn',
    message: 'About to overwrite a `.env` file — secrets may be lost.',
    suggestedFix: 'Append (`>>`) or write to a `.env.local` instead.',
    source: 'core',
  },
  {
    id: 'docker-prune-all',
    pattern: /\bdocker\s+(?:system\s+prune\s+-a|volume\s+prune|image\s+prune\s+-a)\b/i,
    os: ['all'],
    tier: 'warn',
    message: 'Docker prune with `-a` removes unused images / volumes globally.',
    source: 'core',
  },
  {
    id: 'kubectl-delete-broad',
    pattern: /\bkubectl\s+delete\s+(?:all\b|namespace\b|ns\b)/i,
    os: ['all'],
    tier: 'warn',
    message: 'kubectl delete `all` / a namespace affects every resource within.',
    source: 'core',
  },
  {
    id: 'npm-in-pnpm-repo',
    // NOTE: this rule's full semantics depend on the cwd containing a
    // pnpm-lock.yaml — the engine can't see the FS, so we only match the
    // textual command. False positives are expected in non-pnpm repos; the
    // user can disable the rule there.
    pattern: /\bnpm\s+(?:install|i|add)\b/i,
    os: ['all'],
    tier: 'warn',
    message: 'Running `npm install` in a pnpm repo will create a conflicting node_modules.',
    suggestedFix: 'Use `pnpm install` instead.',
    source: 'core',
  },
];
