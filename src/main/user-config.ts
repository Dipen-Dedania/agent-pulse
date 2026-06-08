import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId, BubbleConfig, BubbleSize, BubbleStackPosition, BubbleSoundId, AttentionConfig, WebhookTarget, WebhookKind } from '../common/types';
import { GuardrailConfig } from '../common/guardrails';
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
  antigravityUsage: AntigravityUsageConfig;
  guardrails: GuardrailConfig;
  autoLaunch: boolean;
  analytics: AnalyticsConfig;
  updates: UpdaterConfig;
  scheduler: SchedulerConfig;
}

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agent-pulse-config.json');

const DEFAULTS: UserConfig = {
  enabledBubbles: {
    'claude-code': true,
    'cursor': true,
  },
  bubble: {
    size: 'medium',
    stackPosition: 'bottom-right',
    sound: 'pop',
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

// Validate a persisted bubble block against the known string unions, falling
// back to defaults for any unrecognized/missing field so a hand-edited or
// stale config can't strand the bubbles at an invalid size/corner/sound.
function migrateBubble(raw: unknown): BubbleConfig {
  const d = DEFAULTS.bubble;
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<BubbleConfig>;
  const SIZES: BubbleSize[] = ['small', 'medium', 'large'];
  const POSITIONS: BubbleStackPosition[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const SOUNDS: BubbleSoundId[] = ['pop', 'chime', 'ding', 'marimba', 'none'];
  return {
    size: SIZES.includes(b.size as BubbleSize) ? (b.size as BubbleSize) : d.size,
    stackPosition: POSITIONS.includes(b.stackPosition as BubbleStackPosition)
      ? (b.stackPosition as BubbleStackPosition)
      : d.stackPosition,
    sound: SOUNDS.includes(b.sound as BubbleSoundId) ? (b.sound as BubbleSoundId) : d.sound,
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
        analytics: {
          redactTaskText: typeof analytics.redactTaskText === 'boolean' ? analytics.redactTaskText : DEFAULTS.analytics.redactTaskText,
          idleGapMinutes: typeof analytics.idleGapMinutes === 'number' && analytics.idleGapMinutes >= 1 ? analytics.idleGapMinutes : DEFAULTS.analytics.idleGapMinutes,
        },
        updates: {
          autoCheck: typeof updates.autoCheck === 'boolean' ? updates.autoCheck : DEFAULTS.updates.autoCheck,
          lastCheckedAt: typeof updates.lastCheckedAt === 'number' ? updates.lastCheckedAt : null,
        },
        scheduler: migrateScheduler(parsed.scheduler),
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
    analytics: { ...DEFAULTS.analytics },
    updates: { ...DEFAULTS.updates },
    scheduler: migrateScheduler(undefined),
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
