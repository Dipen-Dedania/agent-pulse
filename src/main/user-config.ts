import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId, BubbleConfig, BubbleSize, BubbleStackPosition, BubbleAnchor, BubbleSoundId, BubbleFillMode, BubbleQuotaStyle, MascotId, AttentionConfig, WebhookTarget, WebhookKind, StatusLineConfig, StatusLineSegment, StatusLineSegmentType, StatusLineColor, StatusLineThreshold, AppearanceConfig, ThemeMode } from '../common/types';
import { CodexStatusLineConfig, CodexStatusLineItem } from '../common/types';
import { isCodexStatusLineItem } from '../common/codex-statusline';
import { MASCOT_HOME, MASCOT_IDS } from '../common/mascotGeometry';
import { TOOL_META } from '../common/toolMeta';
import { GuardrailConfig } from '../common/guardrails';
import {
  BacklogPopulationConfig,
  BacklogSchedulerConfig,
  BacklogSlot,
  BacklogTemplate,
  IssueFilterMode,
  isSafeModelId,
} from '../common/backlog-types';
import { SecretProtectionConfig, SecretRule } from '../common/secretProtection';
import type { StarMilestoneKind, StarVoice } from '../common/star-types';
import { parseHHmm } from './scheduler/timing';
import { logger } from '../common/logger';

// Cap warning fires when REMAINING credit ≤ threshold (i.e. you're about
// to hit the limit). Nudge fires when REMAINING ≥ threshold AND the window
// is within NUDGE_LEAD_MS of resetting — encourages spending unused quota.
export interface UsageNotificationConfig {
  enabled: boolean;
  threshold: number; // 1–99 (% remaining)
}

export interface UsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 60_000 enforced by poller
  showSevenDayBar: boolean;            // toggles the 7-day bar under the Claude bubble
  capWarning: UsageNotificationConfig; // notify when remaining ≤ threshold
  nudge: UsageNotificationConfig;      // notify when remaining ≥ threshold + reset imminent
}

// Codex reports a primary window (5-hour on paid plans) and usually a
// secondary (weekly) one. `showSecondaryBar` mirrors Claude's showSevenDayBar.
export interface CodexUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 600_000 (10m) enforced by poller
  showSecondaryBar: boolean;           // toggles the second (usually weekly) bar under the Codex bubble
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

// Cursor exposes a single billing-cycle quota via /api/usage-summary. The
// credential is read from Cursor's local SQLite DB on every poll, so no manual
// token entry. Hard floor 600_000 (10m); the billing cycle moves slowly.
export interface CursorUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 600_000 (10m) enforced by poller
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

// GitHub Copilot. Metadata (username + SKU) is read from VS Code's local
// state.vscdb every poll — no manual token entry, no network. `liveQuota` gates
// the opt-in path that reads the gho_ OAuth token from the OS keychain and calls
// the undocumented api.github.com/copilot_internal/user endpoint; OFF by default.
// Hard floor 600_000 (10m); the monthly quota moves slowly.
export interface CopilotUsageConfig {
  enabled: boolean;
  liveQuota: boolean;                  // opt-in: keychain read + undocumented API call
  intervalMs: number;                  // hard floor 600_000 (10m) enforced by poller
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

// Antigravity IDE has per-model quotas — the endpoint is local-only (queries
// the IDE's embedded language server) so polling is cheap but only works
// while the IDE is running. Hard floor is 60s, default 5min.
export interface AntigravityUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 60_000 (1m) enforced by poller
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

// Cowork Scheduler — opens a fresh 5-hour window on the user's schedule by
// firing a minimal `claude -p` ping (which also refreshes the OAuth token).
// See scheduler.md. The scheduler reads window state from UsagePoller.
export interface SchedulerSlot {
  time: string;      // 'HH:mm' local — the opener fires at this time
  days: number[];    // weekdays this slot fires on: 0=Sun … 6=Sat
  enabled: boolean;  // disable a row without deleting it
}

export interface SchedulerConfig {
  mode: 'off' | 'fixed' | 'adaptive';
  // fixed: user-defined slots; the opener fires at each on its enabled days.
  fixed: SchedulerSlot[];
  // adaptive: open a window at each block's resetsAt within work hours,
  // capped per day. Robust to manual drift.
  adaptive: {
    workHours: { start: string; end: string }; // 'HH:mm' local
    maxWindowsPerDay: number;
  };
  // tokenNudge: a refresh ping ~leadMs before the OAuth token's expiresAt,
  // fired only when no opener is coming (off mode / long gaps).
  tokenNudge: { enabled: boolean; leadMs: number };
  // Hard cap on opener pings/day so the weekly cap can't quietly drain.
  maxOpenersPerDay: number;
}

// Pulse Timeline (Analytics tab) settings. Persists across launches; lightweight.
export interface AnalyticsConfig {
  redactTaskText: boolean;  // when true, task summaries are written as null
  idleGapMinutes: number;   // minimum gap to close a session; floor enforced at 1 min
}

// Auto-update preferences. lastCheckedAt persists so the Updates tab can show
// "checked X minutes ago" even after a restart.
export interface UpdaterConfig {
  autoCheck: boolean;             // periodic background checks
  lastCheckedAt: number | null;   // unix ms of last completed check (success or no-update)
  // app.getVersion() as of the last time the post-install "What's new" card
  // was dismissed (or first stamped). null = never stamped: a fresh install
  // or the first run of a build that has this field, which stays silent.
  lastRunVersion: string | null;
}

// First-run tour + setup checklist. hasSeenTour flips on finish OR skip — the
// tour must never re-trigger for returning users (it stays re-runnable from
// the splash). firstEventAt is stamped once, on the first hook event this
// install ever receives, and drives the checklist's "first live status" item.
export interface TourConfig {
  hasSeenTour: boolean;
  completedAt: number | null;    // null when skipped rather than finished
  firstEventAt: number | null;
  setupDismissed: boolean;       // user closed the Hooks-tab setup checklist
  // Backlog planner guided tour — a separate in-panel spotlight walk from the
  // first-run bubble tour above. Auto-runs once on first Backlog-tab visit
  // (only after the first-run tour is done), stays re-runnable from the board.
  hasSeenBacklogTour: boolean;
  backlogSetupDismissed: boolean; // user closed the Backlog-board setup checklist
}

// GitHub star nudge (see star-nudge-plan.md). One shared block for the three
// placements (title-bar icon, Updates-tab line, milestone toast) so a single
// click anywhere silences all of them. All timestamps are unix ms.
export interface StarNudgeConfig {
  voice: StarVoice | null;                 // assigned on first boot, then frozen
  starredAt: number | null;                // any star click, anywhere → hides every placement
  milestoneDueAt: number | null;           // main stamped a trigger; toast pending
  milestoneShownAt: number | null;         // toast answered (star or not now) → never again
  milestoneKind: StarMilestoneKind | null; // which copy row the toast uses
}

// Last completed tool detection, persisted so the Hooks tab can paint from it
// instantly on the next launch while a fresh (non-blocking) detection runs
// behind it. `hookInstalled` is deliberately absent: it changes with every
// install/uninstall and is cheap to compute, so it's always read fresh.
export interface DetectionCacheEntry {
  installed: boolean;
  location?: string;
}
export interface DetectionCache {
  detectedAt: number;
  tools: Partial<Record<ToolId, DetectionCacheEntry>>;
}

export interface UserConfig {
  enabledBubbles: Partial<Record<ToolId, boolean>>;
  bubble: BubbleConfig;
  attention: AttentionConfig;
  usage: UsageConfig;
  codexUsage: CodexUsageConfig;
  cursorUsage: CursorUsageConfig;
  copilotUsage: CopilotUsageConfig;
  antigravityUsage: AntigravityUsageConfig;
  guardrails: GuardrailConfig;
  secretProtection: SecretProtectionConfig;
  autoLaunch: boolean;
  analytics: AnalyticsConfig;
  updates: UpdaterConfig;
  tour: TourConfig;
  scheduler: SchedulerConfig;
  // Codex Cowork scheduler — same engine, anchored on Codex's primary (5-hour)
  // window and firing a `codex exec` ping instead of `claude -p`.
  codexScheduler: SchedulerConfig;
  // Backlog Scheduler — time RANGES during which queued backlog cards may
  // auto-execute (vs the Cowork scheduler's fire instants). See backlog.md.
  backlogScheduler: BacklogSchedulerConfig;
  // GitLab issue population (Phase 3): governs how the board self-populates from
  // GitLab issues. See backlog-phase3-gitlab-population-plan.md.
  backlogPopulation: BacklogPopulationConfig;
  // Quick-task templates for the backlog board's card creator.
  backlogTemplates: BacklogTemplate[];
  statusLine: StatusLineConfig;
  // Codex's built-in footer items, written to `[tui] status_line` in
  // ~/.codex/config.toml by the Codex status line editor.
  codexStatusLine: CodexStatusLineConfig;
  appearance: AppearanceConfig;
  starNudge: StarNudgeConfig;
  // Null until the first detection has completed on this install.
  detectionCache: DetectionCache | null;
}

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agent-pulse-config.json');

const DEFAULTS: UserConfig = {
  // Empty by design: on a machine with no saved config we seed enabled bubbles
  // from *detection* at startup (see AgentPulseApp.restoreBubbles) so only tools
  // actually installed get a bubble. A hard-coded `cursor: true` here used to
  // force a phantom Cursor bubble — turned on, undismissable — onto PCs that
  // never had Cursor. Don't reintroduce static defaults.
  enabledBubbles: {},
  bubble: {
    size: 'medium',
    stackPosition: 'bottom-right',
    anchor: null,
    displayId: null,
    displayMatch: null,
    sound: 'pop',
    fillMode: 'glass',
    fillColor: '#ffffff',
    quotaStyle: 'bars',
    hidden: false,
    mascots: {},
    opacity: 1,
  },
  attention: {
    enabled: true,
    escalateAfterSeconds: 30,
    intensifyBubble: true,
    osNotification: false,
    screenEdgeGlow: true,
    webhooks: [],
  },
  usage: {
    enabled: true,
    intervalMs: 10 * 60 * 1000,
    showSevenDayBar: true,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  codexUsage: {
    enabled: true,
    intervalMs: 15 * 60 * 1000,
    showSecondaryBar: true,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  cursorUsage: {
    enabled: true,
    intervalMs: 30 * 60 * 1000,
    capWarning: { enabled: true, threshold: 10 },
    nudge:      { enabled: false, threshold: 50 },
  },
  copilotUsage: {
    enabled: true,
    liveQuota: false,
    intervalMs: 30 * 60 * 1000,
    capWarning: { enabled: true, threshold: 10 },
    nudge:      { enabled: false, threshold: 50 },
  },
  antigravityUsage: {
    enabled: true,
    intervalMs: 5 * 60 * 1000,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  guardrails: {
    enabled: true,
    disabledRuleIds: [],
    customRules: [],
  },
  secretProtection: {
    enabled: true,
    disabledRuleIds: [],
    customRules: [],
    scope: 'global',
    writeIgnoreFiles: true,
    hookBlocking: true,
  },
  autoLaunch: true,
  analytics: {
    redactTaskText: false,
    idleGapMinutes: 5,
  },
  updates: {
    autoCheck: true,
    lastCheckedAt: null,
    lastRunVersion: null,
  },
  tour: {
    hasSeenTour: false,
    completedAt: null,
    firstEventAt: null,
    setupDismissed: false,
    hasSeenBacklogTour: false,
    backlogSetupDismissed: false,
  },
  starNudge: {
    voice: null,
    starredAt: null,
    milestoneDueAt: null,
    milestoneShownAt: null,
    milestoneKind: null,
  },
  scheduler: {
    mode: 'off',
    fixed: [],
    adaptive: {
      workHours: { start: '09:00', end: '18:00' },
      maxWindowsPerDay: 3,
    },
    tokenNudge: { enabled: true, leadMs: 2 * 60 * 1000 },
    maxOpenersPerDay: 6,
  },
  codexScheduler: {
    mode: 'off',
    fixed: [],
    adaptive: {
      workHours: { start: '09:00', end: '18:00' },
      maxWindowsPerDay: 3,
    },
    // Off by default, unlike Claude's: the nudge fires regardless of `mode`,
    // and a Codex ping spends ~16k tokens of the user's ChatGPT subscription
    // window (the Claude nudge is a trivial Haiku API call). Opt-in only.
    tokenNudge: { enabled: false, leadMs: 2 * 60 * 1000 },
    maxOpenersPerDay: 6,
  },
  backlogScheduler: {
    enabled: false,
    slots: [],
    requireIdle: true,
    usageGatePercent: 95, // pause new claims once the 5-hour window is ≥95% spent
    maxConcurrent: 1, // Phase 1: sequential only; migration clamps this
    webhooks: [],
  },
  backlogPopulation: {
    enabled: false,
    defaultFilterMode: 'assigned',
    scoutModel: 'claude-haiku-4-5', // cheap extraction model; Spike 0 confirmed capable
    backgroundRefresh: false,
    refreshIntervalMinutes: 120,
  },
  // Seed templates from backlog.md. Phase 1 is research-only: every template
  // outputs a report/plan — nothing touches the repo.
  backlogTemplates: [
    {
      id: 'tpl-readme',
      name: 'Update README',
      title: 'Update README',
      description:
        'Review the codebase and bring README.md up to date. Output the full proposed README as a markdown report — do not modify any files.',
    },
    {
      id: 'tpl-roadmap-tasks',
      name: 'Roadmap → task list',
      title: 'Turn the roadmap into a task list',
      description:
        'Review ROADMAP.md. Write a detailed development task list for building the entire thing. Include tests that will prove the built work actually works. Output the task list as a markdown report.',
    },
    {
      id: 'tpl-10x-roadmap',
      name: '10x roadmap',
      title: 'Draft a 10x roadmap',
      description:
        'Review our current codebase. What new features or capabilities would make this 10x more valuable? Create a detailed roadmap for building it out, including clearly defined acceptance criteria for each feature.',
    },
    {
      id: 'tpl-smoke-test',
      name: 'Smoke-test hunt',
      title: 'Smoke-test the app and report bugs',
      description:
        'Review the features we have developed so far and smoke-test them by reading the code paths end to end. Find 5 likely bugs that need to be fixed and generate a report about them, with file references and suggested fixes.',
    },
  ],
  // model+effort in one slot, the folder/branch pair that mirrors the Claude
  // default, the actionable context figure, and the two limits this tab is
  // about. Six items stay readable on an 80-column terminal.
  codexStatusLine: {
    items: ['model-with-reasoning', 'current-dir', 'git-branch', 'context-remaining', 'five-hour-limit', 'weekly-limit'],
  },
  statusLine: {
    version: 1,
    separator: '  ·  ',
    // Two-line default: an identity row (model · folder · branch) above a
    // metrics row (context bar · cost · …). Every segment ships its docs-style
    // emoji so enabling one looks polished out of the box.
    lines: [
      {
        segments: [
          { type: 'model', enabled: true, color: 'white', icon: '🧠' },
          { type: 'cwd', enabled: true, color: 'cyan', basenameOnly: true, icon: '📁' },
          { type: 'gitBranch', enabled: true, color: 'magenta', icon: '🌿' },
          { type: 'repo', enabled: false, color: 'blue', icon: '📦' },
          { type: 'pr', enabled: false, color: 'blue', icon: '🔀' },
        ],
      },
      {
        segments: [
          {
            type: 'contextBar',
            enabled: true,
            color: 'auto',
            width: 20,
            fillChar: '█',
            emptyChar: '░',
            showPercent: true,
            thresholds: [
              { at: 0, color: 'green' },
              { at: 50, color: 'yellow' },
              { at: 80, color: 'red' },
            ],
          },
          { type: 'cost', enabled: false, color: 'gray', icon: '💰' },
          { type: 'duration', enabled: false, color: 'gray', icon: '⏰' },
          { type: 'linesChanged', enabled: false, color: 'gray', icon: '±' },
          { type: 'rateLimit', enabled: false, color: 'auto', window: 'five_hour', icon: '📊' },
          { type: 'rateLimit', enabled: false, color: 'auto', window: 'seven_day', icon: '📊' },
          { type: 'outputStyle', enabled: false, color: 'gray', icon: '🎨' },
          { type: 'effort', enabled: false, color: 'gray', icon: '⚡' },
          { type: 'vimMode', enabled: false, color: 'gray', icon: '⌨' },
        ],
      },
    ],
  },
  appearance: { theme: 'auto' },
  detectionCache: null,
};

// Map legacy ToolId keys in persisted configs to their current names so a
// rename in code doesn't strand users on a dead bubble entry. The bubble
// renderer crashes when TOOL_META[toolId] is undefined, so leaving an
// unknown key in enabledBubbles produces a broken bubble window.
const LEGACY_BUBBLE_KEY_RENAMES: Record<string, ToolId> = {
  'gemini-cli': 'antigravity-cli',
};

// Merge a persisted scheduler block over DEFAULTS, validating shapes so a
// corrupt/partial file can't strand the engine. Slots are filtered to valid
// rows; days are clamped to 0–6 integers. `d` selects which defaults fill the
// gaps (Claude's `scheduler` block or the Codex one — identical today).
export function migrateScheduler(raw: unknown, d: SchedulerConfig = DEFAULTS.scheduler): SchedulerConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...d, fixed: [], adaptive: { ...d.adaptive, workHours: { ...d.adaptive.workHours } }, tokenNudge: { ...d.tokenNudge } };
  }
  // Raw is parsed-from-disk JSON of unknown shape — treat as `any` and validate
  // each field below rather than trusting the persisted structure.
  const s = raw as any;
  const mode: SchedulerConfig['mode'] =
    s.mode === 'fixed' || s.mode === 'adaptive' || s.mode === 'off' ? s.mode : d.mode;

  const fixed: SchedulerSlot[] = Array.isArray(s.fixed)
    ? s.fixed
        .filter((row: any): row is SchedulerSlot => !!row && typeof row.time === 'string')
        .map((row: SchedulerSlot) => ({
          time: row.time,
          days: Array.isArray(row.days)
            ? row.days.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
            : [0, 1, 2, 3, 4, 5, 6],
          enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        }))
    : [];

  const adaptiveRaw = s.adaptive ?? {};
  const adaptive = {
    workHours: {
      start: typeof adaptiveRaw.workHours?.start === 'string' ? adaptiveRaw.workHours.start : d.adaptive.workHours.start,
      end:   typeof adaptiveRaw.workHours?.end === 'string'   ? adaptiveRaw.workHours.end   : d.adaptive.workHours.end,
    },
    maxWindowsPerDay:
      typeof adaptiveRaw.maxWindowsPerDay === 'number' && adaptiveRaw.maxWindowsPerDay >= 1
        ? Math.floor(adaptiveRaw.maxWindowsPerDay)
        : d.adaptive.maxWindowsPerDay,
  };

  const nudgeRaw = s.tokenNudge ?? {};
  const tokenNudge = {
    enabled: typeof nudgeRaw.enabled === 'boolean' ? nudgeRaw.enabled : d.tokenNudge.enabled,
    leadMs:  typeof nudgeRaw.leadMs === 'number' && nudgeRaw.leadMs > 0 ? nudgeRaw.leadMs : d.tokenNudge.leadMs,
  };

  const maxOpenersPerDay =
    typeof s.maxOpenersPerDay === 'number' && s.maxOpenersPerDay >= 1
      ? Math.floor(s.maxOpenersPerDay)
      : d.maxOpenersPerDay;

  return { mode, fixed, adaptive, tokenNudge, maxOpenersPerDay };
}

// Validate a persisted Backlog Scheduler block. Slots are filtered to rows with
// two parseable 'HH:mm' times; days clamped to 0–6 integers. `maxConcurrent`
// is forced to 1 in Phase 1 regardless of the persisted value — the engine is
// sequential-only and a hand-edited config must not fan out claude processes.
// Exported: the backlog:scheduler:update-config IPC handler revalidates
// renderer partials through it before persisting.
export function migrateBacklogScheduler(raw: unknown): BacklogSchedulerConfig {
  const d = DEFAULTS.backlogScheduler;
  if (!raw || typeof raw !== 'object') {
    return { ...d, slots: [] };
  }
  const s = raw as any;
  // parseHHmm (not a loose regex) so an out-of-range time like '25:00' is
  // dropped here instead of persisting as a slot that silently never fires.
  const slots: BacklogSlot[] = Array.isArray(s.slots)
    ? s.slots
        .filter((row: any): row is BacklogSlot =>
          !!row && typeof row.start === 'string' && parseHHmm(row.start) !== null &&
          typeof row.end === 'string' && parseHHmm(row.end) !== null)
        .map((row: any) => ({
          start: row.start.trim(),
          end: row.end.trim(),
          days: Array.isArray(row.days)
            ? row.days.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
            : [0, 1, 2, 3, 4, 5, 6],
          enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        }))
    : [];
  // Coerce each row to a well-formed shape but KEEP in-progress rows (empty
  // URL) — this migration runs on every live update too, so dropping blanks
  // here would delete a row the instant the user adds it, before they can type
  // the URL. The engine guards empty/disabled URLs at send time. Only truly
  // malformed rows (non-objects) are discarded; an unknown kind falls back to
  // 'discord'.
  const KINDS: WebhookKind[] = ['discord', 'slack'];
  const webhooks: WebhookTarget[] = Array.isArray(s.webhooks)
    ? s.webhooks
        .filter((row: any) => !!row && typeof row === 'object')
        .map((row: any, i: number) => ({
          id: typeof row.id === 'string' && row.id.length > 0 ? row.id : `wh-${i}`,
          kind: KINDS.includes(row.kind) ? (row.kind as WebhookKind) : 'discord',
          label: typeof row.label === 'string' ? row.label : undefined,
          url: typeof row.url === 'string' ? row.url : '',
          enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        }))
    : [];

  // Clamp to a sane band: below 50% would gate almost immediately every window;
  // above 100 is meaningless. A non-number (older config) falls back to default.
  const rawGate = typeof s.usageGatePercent === 'number' && Number.isFinite(s.usageGatePercent)
    ? s.usageGatePercent
    : d.usageGatePercent;
  const usageGatePercent = Math.min(100, Math.max(50, Math.round(rawGate)));

  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    slots,
    requireIdle: typeof s.requireIdle === 'boolean' ? s.requireIdle : d.requireIdle,
    usageGatePercent,
    maxConcurrent: 1,
    webhooks,
  };
}

// Validate the persisted GitLab-population config. scoutModel must pass
// isSafeModelId (it reaches argv through cmd.exe where no quoting-safe escape
// exists) — an unsafe/absent value falls back to the default. filter mode is
// enum-checked; refresh interval clamped to a sane band. Exported: the
// backlog:population:update-config IPC handler revalidates renderer partials
// through it before persisting.
const FILTER_MODES: IssueFilterMode[] = ['assigned', 'all', 'label'];
export function migrateBacklogPopulation(raw: unknown): BacklogPopulationConfig {
  const d = DEFAULTS.backlogPopulation;
  if (!raw || typeof raw !== 'object') return { ...d };
  const s = raw as any;
  const rawModel = typeof s.scoutModel === 'string' ? s.scoutModel.trim() : '';
  const scoutModel = isSafeModelId(rawModel) ? rawModel : d.scoutModel;
  const refreshIntervalMinutes =
    typeof s.refreshIntervalMinutes === 'number' && Number.isFinite(s.refreshIntervalMinutes)
      ? Math.min(1440, Math.max(15, Math.round(s.refreshIntervalMinutes)))
      : d.refreshIntervalMinutes;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    defaultFilterMode: FILTER_MODES.includes(s.defaultFilterMode) ? s.defaultFilterMode : d.defaultFilterMode,
    scoutModel,
    backgroundRefresh: typeof s.backgroundRefresh === 'boolean' ? s.backgroundRefresh : d.backgroundRefresh,
    refreshIntervalMinutes,
  };
}

// Validate the persisted quick-task template list. Missing/garbage → reseed
// with the shipped defaults; individual rows need non-empty id/name/title.
// Exported: the backlog:templates:update IPC handler reuses it on writes.
export function migrateBacklogTemplates(raw: unknown): BacklogTemplate[] {
  if (!Array.isArray(raw)) {
    return DEFAULTS.backlogTemplates.map((t) => ({ ...t }));
  }
  return raw
    .filter((row: any): row is BacklogTemplate =>
      !!row &&
      typeof row.id === 'string' && row.id.length > 0 &&
      typeof row.name === 'string' && row.name.length > 0 &&
      typeof row.title === 'string' && row.title.length > 0)
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : '',
    }));
}

// Validate a persisted Secret Protection block. Falls back to defaults for any
// missing/garbage field and filters custom rules to well-formed {id, glob} rows
// so a hand-edited config can't strand the engine or the fan-out writer.
function migrateSecretProtection(raw: unknown): SecretProtectionConfig {
  const d = DEFAULTS.secretProtection;
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<SecretProtectionConfig>;
  const customRules: SecretRule[] = Array.isArray(s.customRules)
    ? s.customRules
        .filter((r: any): r is SecretRule =>
          !!r && typeof r.id === 'string' && r.id.length > 0 && typeof r.glob === 'string' && r.glob.length > 0)
        .map((r: any) => ({
          id: r.id,
          glob: r.glob,
          source: 'user' as const,
          message: typeof r.message === 'string' ? r.message : undefined,
        }))
    : [];
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    disabledRuleIds: Array.isArray(s.disabledRuleIds)
      ? s.disabledRuleIds.filter((x: unknown): x is string => typeof x === 'string')
      : [],
    customRules,
    scope: s.scope === 'project' || s.scope === 'global' ? s.scope : d.scope,
    writeIgnoreFiles: typeof s.writeIgnoreFiles === 'boolean' ? s.writeIgnoreFiles : d.writeIgnoreFiles,
    hookBlocking: typeof s.hookBlocking === 'boolean' ? s.hookBlocking : d.hookBlocking,
  };
}

// Validate a persisted bubble block against the known string unions, falling
// back to defaults for any unrecognized/missing field so a hand-edited or
// stale config can't strand the bubbles at an invalid size/corner/sound.
// Per-agent mascot map. Reads the current `mascots` map and, for configs saved
// before the picker existed, the five legacy per-tool booleans
// (mascotClaudeCode etc.), each of which meant "that tool shows its own vendor
// character". Legacy flags are applied first and the map overlays them, so a
// config carrying both (downgrade + re-upgrade) keeps the map's choices. Unknown
// mascot ids and 'none' are dropped, so the result only ever holds real
// assignments. Booleans are not re-emitted: the map is the only shape saved.
const LEGACY_MASCOT_FLAGS: { flag: string; toolId: ToolId }[] = [
  { flag: 'mascotClaudeCode', toolId: 'claude-code' },
  { flag: 'mascotOpenaiCodex', toolId: 'openai-codex' },
  { flag: 'mascotAntigravity', toolId: 'antigravity-cli' },
  { flag: 'mascotKiro', toolId: 'kiro' },
  { flag: 'mascotVscodeCopilot', toolId: 'vscode-copilot' },
];
// Every registered agent, so a mascot assigned to a newly added tool survives
// a config reload (a hand-kept list here silently dropped muse-code).
const TOOL_IDS = Object.keys(TOOL_META) as ToolId[];

export function migrateMascots(raw: unknown): Partial<Record<ToolId, MascotId>> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<Record<ToolId, MascotId>> = {};
  for (const { flag, toolId } of LEGACY_MASCOT_FLAGS) {
    const home = MASCOT_HOME[toolId];
    if (b[flag] === true && home) out[toolId] = home;
  }
  const m = b.mascots;
  if (m && typeof m === 'object') {
    for (const toolId of TOOL_IDS) {
      const v = (m as Record<string, unknown>)[toolId];
      if (typeof v !== 'string') continue;
      if (v === 'none') { delete out[toolId]; continue; }
      if ((MASCOT_IDS as string[]).includes(v)) out[toolId] = v as MascotId;
    }
  }
  return out;
}

export function migrateBubble(raw: unknown): BubbleConfig {
  const d = DEFAULTS.bubble;
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<BubbleConfig>;
  const SIZES: BubbleSize[] = ['small', 'medium', 'large'];
  const POSITIONS: BubbleStackPosition[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const SOUNDS: BubbleSoundId[] = ['pop', 'chime', 'ding', 'marimba', 'none'];
  const FILL_MODES: BubbleFillMode[] = ['glass', 'solid', 'particle', 'waveform'];
  const QUOTA_STYLES: BubbleQuotaStyle[] = ['bars', 'arc'];
  // Accept #rgb/#rrggbb or rgb()/rgba() so a hand-edited config can't feed an
  // arbitrary string into the orb's inline style. Anything else → default.
  const isColor = (v: unknown): v is string =>
    typeof v === 'string' && /^(#([0-9a-f]{3}|[0-9a-f]{6})|rgba?\([\d.,\s%]+\))$/i.test(v.trim());
  // A drag-placed anchor must be a finite point. Coordinates may legitimately
  // be negative (monitors left of / above the primary), so no range check here
  // — BubbleManager clamps onto a live display at placement time.
  const anchor =
    b.anchor && typeof b.anchor === 'object' &&
    Number.isFinite((b.anchor as BubbleAnchor).x) &&
    Number.isFinite((b.anchor as BubbleAnchor).y)
      ? { x: Math.round((b.anchor as BubbleAnchor).x), y: Math.round((b.anchor as BubbleAnchor).y) }
      : null;
  // Electron display ids are opaque integers. No liveness check here — the
  // chosen monitor may simply be unplugged right now; BubbleManager falls back
  // to the primary display at placement time and recovers on hotplug.
  const displayId = Number.isFinite(b.displayId) ? Math.round(b.displayId as number) : null;
  // Reboot-stable monitor identity (display ids regenerate across restarts).
  // Label may legitimately be empty; the bounds must be a finite rect.
  const dm = b.displayMatch as { label?: unknown; bounds?: Record<string, unknown> } | null | undefined;
  const displayMatch =
    dm && typeof dm === 'object' && typeof dm.label === 'string' &&
    dm.bounds && typeof dm.bounds === 'object' &&
    (['x', 'y', 'width', 'height'] as const).every((k) => Number.isFinite(dm.bounds![k]))
      ? {
          label: dm.label,
          bounds: {
            x: Math.round(dm.bounds.x as number),
            y: Math.round(dm.bounds.y as number),
            width: Math.round(dm.bounds.width as number),
            height: Math.round(dm.bounds.height as number),
          },
        }
      : null;
  return {
    size: SIZES.includes(b.size as BubbleSize) ? (b.size as BubbleSize) : d.size,
    stackPosition: POSITIONS.includes(b.stackPosition as BubbleStackPosition)
      ? (b.stackPosition as BubbleStackPosition)
      : d.stackPosition,
    anchor,
    displayId,
    displayMatch,
    sound: SOUNDS.includes(b.sound as BubbleSoundId) ? (b.sound as BubbleSoundId) : d.sound,
    fillMode: FILL_MODES.includes(b.fillMode as BubbleFillMode) ? (b.fillMode as BubbleFillMode) : d.fillMode,
    fillColor: isColor(b.fillColor) ? b.fillColor.trim() : d.fillColor,
    quotaStyle: QUOTA_STYLES.includes(b.quotaStyle as BubbleQuotaStyle) ? (b.quotaStyle as BubbleQuotaStyle) : d.quotaStyle,
    hidden: typeof b.hidden === 'boolean' ? b.hidden : d.hidden,
    mascots: migrateMascots(b),
    // Clamp to a floor of 0.3 so a stale/hand-edited config can't make the
    // bubbles effectively invisible (and unfindable).
    opacity: typeof b.opacity === 'number' && Number.isFinite(b.opacity)
      ? Math.min(1, Math.max(0.3, b.opacity))
      : d.opacity,
  };
}

// Validate a persisted tour block. Timestamps must be positive finite numbers
// or null — a hand-edited value can't strand the checklist in a weird state.
function migrateTour(raw: unknown): TourConfig {
  const d = DEFAULTS.tour;
  const t = (raw && typeof raw === 'object' ? raw : {}) as Partial<TourConfig>;
  const ts = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  return {
    hasSeenTour: typeof t.hasSeenTour === 'boolean' ? t.hasSeenTour : d.hasSeenTour,
    completedAt: ts(t.completedAt),
    firstEventAt: ts(t.firstEventAt),
    setupDismissed: typeof t.setupDismissed === 'boolean' ? t.setupDismissed : d.setupDismissed,
    hasSeenBacklogTour:
      typeof t.hasSeenBacklogTour === 'boolean' ? t.hasSeenBacklogTour : d.hasSeenBacklogTour,
    backlogSetupDismissed:
      typeof t.backlogSetupDismissed === 'boolean' ? t.backlogSetupDismissed : d.backlogSetupDismissed,
  };
}

// Validate a persisted star-nudge block. Same rules as migrateTour: timestamps
// must be positive finite numbers or null; an unknown voice or kind becomes
// null (the voice is then re-assigned on boot, the kind only matters while a
// toast is pending).
export function migrateStarNudge(raw: unknown): StarNudgeConfig {
  const VOICES: StarVoice[] = ['earnest', 'playful'];
  const KINDS: StarMilestoneKind[] = ['week', 'backlog'];
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<StarNudgeConfig>;
  const ts = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  return {
    voice: VOICES.includes(s.voice as StarVoice) ? (s.voice as StarVoice) : null,
    starredAt: ts(s.starredAt),
    milestoneDueAt: ts(s.milestoneDueAt),
    milestoneShownAt: ts(s.milestoneShownAt),
    milestoneKind: KINDS.includes(s.milestoneKind as StarMilestoneKind) ? (s.milestoneKind as StarMilestoneKind) : null,
  };
}

export function migrateAppearance(raw: unknown): AppearanceConfig {
  const THEMES: ThemeMode[] = ['light', 'dark', 'auto'];
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppearanceConfig>;
  return { theme: THEMES.includes(a.theme as ThemeMode) ? a.theme! : 'auto' };
}

// Validate a persisted detection cache. Anything malformed collapses to null,
// which simply means "detect before painting" on the next launch — the cache is
// an accelerator, never a source of truth. Unknown tool ids are dropped and a
// cache with no usable entries is treated as absent.
export function migrateDetectionCache(raw: unknown): DetectionCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<DetectionCache>;
  if (typeof c.detectedAt !== 'number' || !Number.isFinite(c.detectedAt) || c.detectedAt <= 0) return null;
  if (!c.tools || typeof c.tools !== 'object') return null;
  const tools: Partial<Record<ToolId, DetectionCacheEntry>> = {};
  for (const toolId of TOOL_IDS) {
    const entry = (c.tools as Record<string, unknown>)[toolId];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<DetectionCacheEntry>;
    if (typeof e.installed !== 'boolean') continue;
    tools[toolId] = typeof e.location === 'string' && e.location
      ? { installed: e.installed, location: e.location }
      : { installed: e.installed };
  }
  if (Object.keys(tools).length === 0) return null;
  return { detectedAt: Math.floor(c.detectedAt), tools };
}

// Smallest allowed escalation delay. Below this the feature would fire almost
// instantly on every `waiting` flip, defeating the "give the user a moment"
// intent and risking webhook spam.
const MIN_ESCALATE_SECONDS = 5;

// Validate a persisted attention block. Clamps the threshold to a sane floor
// and filters the webhook list to well-formed rows so a hand-edited or stale
// config can't strand the engine or POST to a garbage URL.
function migrateAttention(raw: unknown): AttentionConfig {
  const d = DEFAULTS.attention;
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<AttentionConfig>;
  const KINDS: WebhookKind[] = ['discord', 'slack'];

  const seconds =
    typeof a.escalateAfterSeconds === 'number' && a.escalateAfterSeconds >= MIN_ESCALATE_SECONDS
      ? Math.floor(a.escalateAfterSeconds)
      : d.escalateAfterSeconds;

  const webhooks: WebhookTarget[] = Array.isArray(a.webhooks)
    ? a.webhooks
        .filter((row: any): row is WebhookTarget =>
          !!row && typeof row.url === 'string' && row.url.trim().length > 0 && KINDS.includes(row.kind))
        .map((row: any, i: number) => ({
          id: typeof row.id === 'string' && row.id.length > 0 ? row.id : `wh-${i}-${row.kind}`,
          kind: row.kind as WebhookKind,
          label: typeof row.label === 'string' ? row.label : undefined,
          url: row.url,
          enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
        }))
    : [];

  return {
    enabled: typeof a.enabled === 'boolean' ? a.enabled : d.enabled,
    escalateAfterSeconds: seconds,
    intensifyBubble: typeof a.intensifyBubble === 'boolean' ? a.intensifyBubble : d.intensifyBubble,
    osNotification: typeof a.osNotification === 'boolean' ? a.osNotification : d.osNotification,
    screenEdgeGlow: typeof a.screenEdgeGlow === 'boolean' ? a.screenEdgeGlow : d.screenEdgeGlow,
    webhooks,
  };
}

// Whitelists for status-line validation — anything off-list falls back to a
// default so a hand-edited or stale config can't feed garbage to the deployed
// renderer script (which trusts the projected JSON).
const STATUS_LINE_SEGMENT_TYPES: StatusLineSegmentType[] = [
  'model', 'contextBar', 'cwd', 'projectDir', 'gitBranch', 'repo', 'cost',
  'duration', 'linesChanged', 'rateLimit', 'outputStyle', 'effort', 'vimMode', 'pr',
];
const STATUS_LINE_COLORS: StatusLineColor[] = [
  'auto', 'white', 'gray', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan',
];

function migrateStatusLineColor(raw: unknown, fallback: StatusLineColor): StatusLineColor {
  return STATUS_LINE_COLORS.includes(raw as StatusLineColor) ? (raw as StatusLineColor) : fallback;
}

function migrateStatusLineThresholds(raw: unknown): StatusLineThreshold[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stops = raw
    .filter((t: any) => t && typeof t.at === 'number')
    .map((t: any) => ({
      at: Math.max(0, Math.min(100, Math.floor(t.at))),
      color: migrateStatusLineColor(t.color, 'white'),
    }))
    .sort((a, b) => a.at - b.at);
  return stops.length ? stops : undefined;
}

function migrateStatusLineSegment(raw: any): StatusLineSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!STATUS_LINE_SEGMENT_TYPES.includes(raw.type)) return null;
  const seg: StatusLineSegment = {
    type: raw.type,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
  };
  if (raw.color !== undefined) seg.color = migrateStatusLineColor(raw.color, 'white');
  if (typeof raw.icon === 'string') seg.icon = raw.icon.slice(0, 8);
  if (typeof raw.width === 'number') seg.width = Math.max(4, Math.min(40, Math.floor(raw.width)));
  if (typeof raw.fillChar === 'string' && raw.fillChar.length) seg.fillChar = raw.fillChar.slice(0, 2);
  if (typeof raw.emptyChar === 'string' && raw.emptyChar.length) seg.emptyChar = raw.emptyChar.slice(0, 2);
  if (typeof raw.showPercent === 'boolean') seg.showPercent = raw.showPercent;
  const thresholds = migrateStatusLineThresholds(raw.thresholds);
  if (thresholds) seg.thresholds = thresholds;
  if (raw.window === 'five_hour' || raw.window === 'seven_day') seg.window = raw.window;
  if (typeof raw.basenameOnly === 'boolean') seg.basenameOnly = raw.basenameOnly;
  return seg;
}

// Validate a persisted status-line block. Falls back wholesale to defaults when
// the shape is unusable so the installer always has a sane config to project.
function migrateStatusLine(raw: unknown): StatusLineConfig {
  const d = DEFAULTS.statusLine;
  if (!raw || typeof raw !== 'object') {
    return { version: 1, separator: d.separator, lines: d.lines.map((l) => ({ ...l, segments: l.segments.map((s) => ({ ...s })) })) };
  }
  const s = raw as any;
  const separator = typeof s.separator === 'string' ? s.separator : d.separator;
  const maxItemsPerLine = typeof s.maxItemsPerLine === 'number' && s.maxItemsPerLine > 0
    ? Math.max(1, Math.min(20, Math.floor(s.maxItemsPerLine)))
    : undefined;
  const wrap = maxItemsPerLine ? { maxItemsPerLine } : {};
  const linesRaw = Array.isArray(s.lines) ? s.lines : [];
  const lines = linesRaw
    .map((row: any) => {
      if (!row || !Array.isArray(row.segments)) return null;
      const segments = row.segments
        .map(migrateStatusLineSegment)
        .filter((seg: StatusLineSegment | null): seg is StatusLineSegment => seg != null);
      return {
        ...(typeof row.separator === 'string' ? { separator: row.separator } : {}),
        segments,
      };
    })
    .filter((row: any): row is { separator?: string; segments: StatusLineSegment[] } => row != null && row.segments.length > 0);

  // Empty/garbage → fall back to defaults rather than render a blank line.
  if (!lines.length) {
    return { version: 1, separator, lines: d.lines.map((l) => ({ ...l, segments: l.segments.map((seg) => ({ ...seg })) })), ...wrap };
  }
  return { version: 1, separator, lines, ...wrap };
}

// A fresh copy of the shipped default status-line layout (two lines + icons).
// Used by the "Reset to default" action so the renderer never has to duplicate
// the DEFAULTS shape.
export function defaultStatusLineConfig(): StatusLineConfig {
  return migrateStatusLine(undefined);
}

// Validate a persisted Codex status-line block: known item ids only, deduped in
// order; an empty or unusable list falls back to the shipped default so the
// installer never writes `status_line = []`.
export function migrateCodexStatusLine(raw: unknown): CodexStatusLineConfig {
  const d = DEFAULTS.codexStatusLine;
  const list = raw && typeof raw === 'object' && Array.isArray((raw as any).items) ? (raw as any).items : null;
  if (!list) return { items: [...d.items] };
  const seen = new Set<CodexStatusLineItem>();
  for (const entry of list) {
    if (isCodexStatusLineItem(entry)) seen.add(entry);
  }
  return { items: seen.size > 0 ? [...seen] : [...d.items] };
}

export function defaultCodexStatusLineConfig(): CodexStatusLineConfig {
  return migrateCodexStatusLine(undefined);
}

function migrateEnabledBubbles(raw: unknown): Partial<Record<ToolId, boolean>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<ToolId, boolean>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'boolean') continue;
    const renamed = LEGACY_BUBBLE_KEY_RENAMES[key];
    const finalKey = (renamed ?? key) as ToolId;
    // Don't overwrite an existing modern entry with a stale legacy value.
    if (out[finalKey] === undefined) out[finalKey] = value;
  }
  return out;
}

export function loadConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const usage = parsed.usage ?? {};
      const codexUsage = parsed.codexUsage ?? {};
      const cursorUsage = parsed.cursorUsage ?? {};
      const copilotUsage = parsed.copilotUsage ?? {};
      const antigravityUsage = parsed.antigravityUsage ?? {};
      const guardrails = parsed.guardrails ?? {};
      const analytics = parsed.analytics ?? {};
      const updates = parsed.updates ?? {};
      return {
        ...DEFAULTS,
        ...parsed,
        enabledBubbles: migrateEnabledBubbles(parsed.enabledBubbles),
        bubble: migrateBubble(parsed.bubble),
        attention: migrateAttention(parsed.attention),
        usage: {
          ...DEFAULTS.usage,
          ...usage,
          capWarning: { ...DEFAULTS.usage.capWarning, ...(usage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.usage.nudge,      ...(usage.nudge ?? {}) },
        },
        codexUsage: {
          ...DEFAULTS.codexUsage,
          ...codexUsage,
          capWarning: { ...DEFAULTS.codexUsage.capWarning, ...(codexUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.codexUsage.nudge,      ...(codexUsage.nudge ?? {}) },
        },
        cursorUsage: {
          ...DEFAULTS.cursorUsage,
          ...cursorUsage,
          capWarning: { ...DEFAULTS.cursorUsage.capWarning, ...(cursorUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.cursorUsage.nudge,      ...(cursorUsage.nudge ?? {}) },
        },
        copilotUsage: {
          ...DEFAULTS.copilotUsage,
          ...copilotUsage,
          capWarning: { ...DEFAULTS.copilotUsage.capWarning, ...(copilotUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.copilotUsage.nudge,      ...(copilotUsage.nudge ?? {}) },
        },
        antigravityUsage: {
          ...DEFAULTS.antigravityUsage,
          ...antigravityUsage,
          capWarning: { ...DEFAULTS.antigravityUsage.capWarning, ...(antigravityUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.antigravityUsage.nudge,      ...(antigravityUsage.nudge ?? {}) },
        },
        guardrails: {
          enabled:         guardrails.enabled ?? DEFAULTS.guardrails.enabled,
          disabledRuleIds: Array.isArray(guardrails.disabledRuleIds) ? guardrails.disabledRuleIds : [],
          customRules:     Array.isArray(guardrails.customRules)     ? guardrails.customRules     : [],
        },
        secretProtection: migrateSecretProtection(parsed.secretProtection),
        analytics: {
          redactTaskText: typeof analytics.redactTaskText === 'boolean' ? analytics.redactTaskText : DEFAULTS.analytics.redactTaskText,
          idleGapMinutes: typeof analytics.idleGapMinutes === 'number' && analytics.idleGapMinutes >= 1 ? analytics.idleGapMinutes : DEFAULTS.analytics.idleGapMinutes,
        },
        updates: {
          autoCheck: typeof updates.autoCheck === 'boolean' ? updates.autoCheck : DEFAULTS.updates.autoCheck,
          lastCheckedAt: typeof updates.lastCheckedAt === 'number' ? updates.lastCheckedAt : null,
          lastRunVersion: typeof updates.lastRunVersion === 'string' && updates.lastRunVersion ? updates.lastRunVersion : null,
        },
        tour: migrateTour(parsed.tour),
        starNudge: migrateStarNudge(parsed.starNudge),
        scheduler: migrateScheduler(parsed.scheduler),
        codexScheduler: migrateScheduler(parsed.codexScheduler, DEFAULTS.codexScheduler),
        backlogScheduler: migrateBacklogScheduler(parsed.backlogScheduler),
        backlogPopulation: migrateBacklogPopulation(parsed.backlogPopulation),
        backlogTemplates: migrateBacklogTemplates(parsed.backlogTemplates),
        statusLine: migrateStatusLine(parsed.statusLine),
        codexStatusLine: migrateCodexStatusLine(parsed.codexStatusLine),
        appearance: migrateAppearance(parsed.appearance),
        detectionCache: migrateDetectionCache(parsed.detectionCache),
      };
    }
  } catch {
    // Corrupt config — fall back to defaults
  }
  return {
    ...DEFAULTS,
    bubble: { ...DEFAULTS.bubble },
    attention: { ...DEFAULTS.attention, webhooks: [] },
    usage: {
      ...DEFAULTS.usage,
      capWarning: { ...DEFAULTS.usage.capWarning },
      nudge:      { ...DEFAULTS.usage.nudge },
    },
    codexUsage: {
      ...DEFAULTS.codexUsage,
      capWarning: { ...DEFAULTS.codexUsage.capWarning },
      nudge:      { ...DEFAULTS.codexUsage.nudge },
    },
    cursorUsage: {
      ...DEFAULTS.cursorUsage,
      capWarning: { ...DEFAULTS.cursorUsage.capWarning },
      nudge:      { ...DEFAULTS.cursorUsage.nudge },
    },
    copilotUsage: {
      ...DEFAULTS.copilotUsage,
      capWarning: { ...DEFAULTS.copilotUsage.capWarning },
      nudge:      { ...DEFAULTS.copilotUsage.nudge },
    },
    antigravityUsage: {
      ...DEFAULTS.antigravityUsage,
      capWarning: { ...DEFAULTS.antigravityUsage.capWarning },
      nudge:      { ...DEFAULTS.antigravityUsage.nudge },
    },
    guardrails: {
      ...DEFAULTS.guardrails,
      disabledRuleIds: [...DEFAULTS.guardrails.disabledRuleIds],
      customRules:     [...DEFAULTS.guardrails.customRules],
    },
    secretProtection: migrateSecretProtection(undefined),
    analytics: { ...DEFAULTS.analytics },
    updates: { ...DEFAULTS.updates },
    tour: migrateTour(undefined),
    starNudge: migrateStarNudge(undefined),
    scheduler: migrateScheduler(undefined),
    codexScheduler: migrateScheduler(undefined, DEFAULTS.codexScheduler),
    backlogScheduler: migrateBacklogScheduler(undefined),
    backlogPopulation: migrateBacklogPopulation(undefined),
    backlogTemplates: migrateBacklogTemplates(undefined),
    statusLine: migrateStatusLine(undefined),
    codexStatusLine: migrateCodexStatusLine(undefined),
    appearance: migrateAppearance(undefined),
    detectionCache: null,
  };
}

export function saveConfig(config: UserConfig): void {
  try {
    // ~/.claude may not exist on a machine where Claude Code was never
    // installed (e.g. a fresh Linux box), so create the parent dir before
    // writing — otherwise writeFileSync throws ENOENT and config never
    // persists across launches.
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    logger.error('Failed to save user config:', e);
  }
}
