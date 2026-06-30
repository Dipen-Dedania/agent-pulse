import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId, BubbleConfig, BubbleSize, BubbleStackPosition, BubbleAnchor, BubbleSoundId, BubbleFillMode, AttentionConfig, WebhookTarget, WebhookKind, StatusLineConfig, StatusLineSegment, StatusLineSegmentType, StatusLineColor, StatusLineThreshold } from '../common/types';
import { GuardrailConfig } from '../common/guardrails';
import { SecretProtectionConfig, SecretRule } from '../common/secretProtection';
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

// Codex tracks a single weekly window (occasionally a secondary one). No
// per-bar visibility toggle — we always render whatever the API returns.
export interface CodexUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 600_000 (10m) enforced by poller
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
  scheduler: SchedulerConfig;
  statusLine: StatusLineConfig;
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
    hidden: false,
  },
  attention: {
    enabled: true,
    escalateAfterSeconds: 30,
    intensifyBubble: true,
    osNotification: false,
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
  autoLaunch: false,
  analytics: {
    redactTaskText: false,
    idleGapMinutes: 5,
  },
  updates: {
    autoCheck: true,
    lastCheckedAt: null,
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
// rows; days are clamped to 0–6 integers.
function migrateScheduler(raw: unknown): SchedulerConfig {
  const d = DEFAULTS.scheduler;
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
function migrateBubble(raw: unknown): BubbleConfig {
  const d = DEFAULTS.bubble;
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<BubbleConfig>;
  const SIZES: BubbleSize[] = ['small', 'medium', 'large'];
  const POSITIONS: BubbleStackPosition[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const SOUNDS: BubbleSoundId[] = ['pop', 'chime', 'ding', 'marimba', 'none'];
  const FILL_MODES: BubbleFillMode[] = ['glass', 'solid'];
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
    hidden: typeof b.hidden === 'boolean' ? b.hidden : d.hidden,
  };
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
        },
        scheduler: migrateScheduler(parsed.scheduler),
        statusLine: migrateStatusLine(parsed.statusLine),
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
    scheduler: migrateScheduler(undefined),
    statusLine: migrateStatusLine(undefined),
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
