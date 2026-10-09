/**
 * Scripted chapters for the live demo stage.
 *
 * A scene is data: a starting frame plus timed patches. The frame at time t is
 * the starting frame with every patch whose `at` <= t folded in, so playback is
 * deterministic and seekable — adding a chapter needs no new code.
 * Toast copy mirrors the app's real webhook messages
 * (src/main/attention/engine.ts, src/main/backlog/engine.ts); guardrail rule
 * ids come from src/main/guardrails/rules.core.ts.
 */
import type { AgentState } from './stateMeta';

export type LineTone = 'cmd' | 'muted' | 'ok' | 'bad' | 'chat-you' | 'chat-agent';

export interface TermLine {
  text: string;
  tone: LineTone;
  /** Typewriter reveal (commands the "user" types). */
  typed?: boolean;
}

export interface Toast {
  source: 'Slack' | 'Discord' | 'Agent Pulse';
  title: string;
  body: string;
  tone: 'info' | 'ok' | 'bad';
}

export interface Board {
  todo: string[];
  doing: string[];
  done: string[];
  /** Card to highlight as just-added. */
  fresh?: string;
}

export interface GuardrailRule {
  id: string;
  tier: 'block' | 'warn';
  custom?: boolean;
}

export interface GuardrailTrigger {
  rule: string;
  cmd: string;
  time: string;
  custom?: boolean;
}

/** The Guardrails window: recent triggers, the rule list, and a rule being typed in. */
export interface Guardrails {
  log: GuardrailTrigger[];
  rules: GuardrailRule[];
  /** Custom rule being typed into the "Add rule" form. */
  draft: { id: string; pattern: string } | null;
  /** Log entry or rule id to highlight as just-added. */
  fresh?: string;
}

/** The Analytics window. `value` is estimated API list-price value, never real billing. */
export interface Usage {
  tokens: number;
  value: number;
  sessions: number;
  /** Token share per tool, keyed by `tools[].id`. */
  bars: { tool: string; tokens: number }[];
}

export interface Frame {
  state: AgentState;
  clock: string;
  panel: 'terminal' | 'board';
  /** An Agent Pulse window opened over the app panel. */
  window: 'guardrails' | 'analytics' | null;
  lines: TermLine[];
  prompt: boolean;
  glow: boolean;
  toast: Toast | null;
  board: Board;
  guardrails: Guardrails;
  usage: Usage;
  /** Plan quota remaining (0–100) shown as the arc around the bubble; null hides it. */
  quota: number | null;
  caption: string;
}

/** A patch replaces fields; `print` appends a terminal line instead. */
export type Patch = Partial<Omit<Frame, 'lines'>> & { at: number; print?: TermLine };

export interface Scene {
  id: string;
  title: string;
  duration: number;
  start: Frame;
  steps: Patch[];
}

const EMPTY_BOARD: Board = { todo: [], doing: [], done: [] };

/** A few of the built-in rules (src/main/guardrails/rules.core.ts). */
const BUILTIN_RULES: GuardrailRule[] = [
  { id: 'rm-rf-root', tier: 'block' },
  { id: 'drop-database', tier: 'block' },
  { id: 'pipe-to-shell', tier: 'block' },
  { id: 'git-push-force', tier: 'warn' },
];
const CUSTOM_RULE: GuardrailRule = { id: 'no-npm-publish', tier: 'block', custom: true };
const ROOT_TRIGGER: GuardrailTrigger = { rule: 'rm-rf-root', cmd: 'rm -rf /', time: '14:20' };

const base: Frame = {
  state: 'idle',
  clock: '09:41',
  panel: 'terminal',
  window: null,
  lines: [],
  prompt: false,
  glow: false,
  toast: null,
  board: EMPTY_BOARD,
  guardrails: { log: [], rules: BUILTIN_RULES, draft: null },
  usage: { tokens: 0, value: 0, sessions: 0, bars: [] },
  quota: null,
  caption: '',
};

const usageAt = (claude: number, codex: number, cursor: number, sessions: number): Usage => {
  const tokens = claude + codex + cursor;
  return {
    tokens,
    // ~$2.50 per million tokens, a blended list-price estimate for the demo.
    value: (tokens / 1e6) * 2.5,
    sessions,
    bars: [
      { tool: 'claude-code', tokens: claude },
      { tool: 'openai-codex', tokens: codex },
      { tool: 'cursor', tokens: cursor },
    ],
  };
};

export const SCENES: Scene[] = [
  {
    id: 'needs-you',
    title: 'Needs you',
    duration: 11500,
    start: { ...base, state: 'working', clock: '10:02', caption: 'You step into a meeting. Claude keeps building…' },
    steps: [
      { at: 0, print: { text: '$ claude "refactor the auth middleware"', tone: 'cmd', typed: true } },
      { at: 1100, print: { text: '● Read src/auth/middleware.ts', tone: 'muted' } },
      { at: 1900, print: { text: '● Planning edits across 3 files…', tone: 'muted' } },
      {
        at: 3000,
        state: 'waiting',
        prompt: true,
        caption: 'It needs your OK — the bubble flips to Waiting the instant it asks.',
      },
      {
        at: 5200,
        clock: '10:05',
        glow: true,
        toast: {
          source: 'Slack',
          title: 'Claude Code needs you',
          body: 'refactor the auth middleware · Idle for 180s',
          tone: 'info',
        },
        caption: 'Still waiting past your threshold? The screen edge glows and Slack pings you.',
      },
      {
        at: 7800,
        state: 'working',
        prompt: false,
        glow: false,
        toast: null,
        print: { text: '✔ Allowed once', tone: 'ok' },
        caption: 'One click and it’s back to work.',
      },
      { at: 8700, print: { text: '● Edited 3 files · tests passing', tone: 'muted' } },
      {
        at: 9600,
        state: 'idle-active',
        print: { text: '✔ Done — ready for your next prompt', tone: 'ok' },
        caption: 'Finished. You knew without opening a single tab.',
      },
    ],
  },
  {
    id: 'guardrails',
    title: 'Guardrails',
    duration: 16000,
    start: {
      ...base,
      state: 'working',
      clock: '14:20',
      caption: 'An agent decides to tidy up the build output and ship it…',
    },
    steps: [
      { at: 0, print: { text: '$ claude "clean up the build and ship it"', tone: 'cmd', typed: true } },
      { at: 1300, print: { text: '● Bash  rm -rf /', tone: 'bad' } },
      {
        at: 2200,
        state: 'error',
        print: { text: '✖ Blocked by guardrail: rm-rf-root', tone: 'bad' },
        toast: {
          source: 'Agent Pulse',
          title: 'Blocked · rm-rf-root',
          body: 'Destructive command stopped before it ran.',
          tone: 'bad',
        },
        guardrails: { log: [ROOT_TRIGGER], rules: BUILTIN_RULES, draft: null },
        caption: 'Guardrails stop destructive commands before they ever run.',
      },
      {
        at: 4400,
        toast: null,
        window: 'guardrails',
        guardrails: { log: [ROOT_TRIGGER], rules: BUILTIN_RULES, draft: null, fresh: 'rm-rf-root' },
        caption: 'Every trigger lands in the Guardrails log — what ran, which rule, when.',
      },
      {
        at: 6600,
        guardrails: {
          log: [ROOT_TRIGGER],
          rules: BUILTIN_RULES,
          draft: { id: 'no-npm-publish', pattern: '\\bnpm\\s+publish\\b' },
        },
        caption: 'Want a rule of your own? Add one in seconds…',
      },
      {
        at: 8600,
        guardrails: {
          log: [ROOT_TRIGGER],
          rules: [...BUILTIN_RULES, CUSTOM_RULE],
          draft: null,
          fresh: CUSTOM_RULE.id,
        },
        caption: '…like “never publish without me”.',
      },
      {
        at: 10200,
        window: null,
        state: 'working',
        print: { text: '● Bash  rm -rf ./dist && npm run build', tone: 'muted' },
        caption: 'Back in the terminal, the agent course-corrects…',
      },
      { at: 11200, print: { text: '● Bash  npm publish', tone: 'bad' } },
      {
        at: 12000,
        state: 'error',
        print: { text: '✖ Blocked by guardrail: no-npm-publish', tone: 'bad' },
        toast: {
          source: 'Agent Pulse',
          title: 'Blocked · no-npm-publish',
          body: 'Your custom rule caught it.',
          tone: 'bad',
        },
        guardrails: {
          log: [{ rule: CUSTOM_RULE.id, cmd: 'npm publish', time: '14:23', custom: true }, ROOT_TRIGGER],
          rules: [...BUILTIN_RULES, CUSTOM_RULE],
          draft: null,
        },
        caption: 'Your rule fires just like the built-ins.',
      },
      {
        at: 14200,
        state: 'idle-active',
        toast: null,
        print: { text: '✔ Built ./dist — publishing is left to you', tone: 'ok' },
        caption: 'The agent stops short and leaves the risky step to you.',
      },
    ],
  },
  {
    id: 'night-shift',
    title: 'Night shift',
    duration: 12500,
    start: {
      ...base,
      state: 'idle',
      clock: '17:45',
      panel: 'board',
      board: { todo: ['Fix flaky e2e login'], doing: [], done: [] },
      caption: 'End of day. Ask Claude to park a task for tonight.',
    },
    steps: [
      { at: 0, print: { text: 'you › add “write parser tests” to my backlog', tone: 'chat-you', typed: true } },
      {
        at: 1700,
        print: { text: 'claude › Added to Agent Pulse · Todo', tone: 'chat-agent' },
        board: { todo: ['Fix flaky e2e login', 'Write parser tests'], doing: [], done: [], fresh: 'Write parser tests' },
        caption: 'The Agent Pulse MCP server drops it straight onto your board.',
      },
      {
        at: 4000,
        clock: '02:00',
        state: 'working',
        board: { todo: ['Fix flaky e2e login'], doing: ['Write parser tests'], done: [] },
        caption: 'Inside your scheduler window, cards run themselves.',
      },
      {
        at: 7000,
        board: { todo: [], doing: ['Fix flaky e2e login'], done: ['Write parser tests'] },
        toast: {
          source: 'Discord',
          title: '✅ Backlog task completed: Write parser tests',
          body: 'Claiming the next card…',
          tone: 'ok',
        },
        caption: 'Each finished card pings Discord or Slack, then claims the next.',
      },
      {
        at: 10000,
        clock: '03:12',
        state: 'idle-active',
        toast: null,
        board: { todo: [], doing: [], done: ['Write parser tests', 'Fix flaky e2e login'] },
        caption: 'Wake up to a board of finished work.',
      },
    ],
  },
  {
    id: 'usage',
    title: 'Usage',
    duration: 12000,
    start: {
      ...base,
      state: 'working',
      clock: '11:30',
      window: 'analytics',
      usage: usageAt(820_000, 310_000, 140_000, 4),
      quota: 72,
      caption: 'Every agent’s tokens, tallied as you work.',
    },
    steps: [
      { at: 0, print: { text: '$ claude "migrate the billing tests"', tone: 'cmd', typed: true } },
      { at: 1600, usage: usageAt(1_010_000, 330_000, 150_000, 4), quota: 64 },
      {
        at: 3400,
        usage: usageAt(1_240_000, 410_000, 150_000, 5),
        quota: 48,
        caption: 'The ring around the bubble is your plan quota — it drains as you go.',
      },
      {
        at: 6200,
        clock: '12:05',
        usage: usageAt(1_520_000, 480_000, 190_000, 5),
        quota: 33,
        caption: 'Estimated API value shows what your plan is worth — at list prices, never your bill.',
      },
      {
        at: 9000,
        clock: '12:40',
        state: 'idle-active',
        usage: usageAt(1_780_000, 520_000, 190_000, 6),
        quota: 17,
        caption: 'Green, amber, red — you see the limit coming before you hit it.',
      },
    ],
  },
];

/** Fold every step at or before `t` into the scene's starting frame. */
export function frameAt(scene: Scene, t: number): Frame {
  let frame: Frame = { ...scene.start, lines: [...scene.start.lines] };
  for (const step of scene.steps) {
    if (step.at > t) break;
    const { at: _at, print, ...patch } = step;
    frame = { ...frame, ...patch };
    if (print) frame.lines = [...frame.lines, print];
  }
  return frame;
}

/** Index of the last step applied at `t` (changes only when the frame does). */
export function stepIndexAt(scene: Scene, t: number): number {
  let idx = -1;
  scene.steps.forEach((s, i) => {
    if (s.at <= t) idx = i;
  });
  return idx;
}

/** Hand-picked frames for "Your turn" mode, one per state. */
export const PLAY_FRAMES: Record<AgentState, Frame> = {
  working: {
    ...base,
    state: 'working',
    lines: [
      { text: '$ claude "add dark mode to settings"', tone: 'cmd' },
      { text: '● Editing src/settings/theme.ts…', tone: 'muted' },
    ],
    caption: 'Working — green glow; mascots get busy.',
  },
  waiting: {
    ...base,
    state: 'waiting',
    lines: [{ text: '$ claude "add dark mode to settings"', tone: 'cmd' }],
    prompt: true,
    glow: true,
    caption: 'Waiting — it needs you. Escalates to the screen edge, OS and Slack/Discord.',
  },
  'idle-active': {
    ...base,
    state: 'idle-active',
    lines: [
      { text: '$ claude "add dark mode to settings"', tone: 'cmd' },
      { text: '✔ Done — ready for your next prompt', tone: 'ok' },
    ],
    caption: 'Idle (active) — the turn finished; your move.',
  },
  idle: {
    ...base,
    state: 'idle',
    lines: [{ text: '$ ', tone: 'cmd' }],
    caption: 'Idle — no session running; calm and quiet.',
  },
  error: {
    ...base,
    state: 'error',
    lines: [
      { text: '$ claude "add dark mode to settings"', tone: 'cmd' },
      { text: '✖ Session ended unexpectedly', tone: 'bad' },
    ],
    caption: 'Error — the agent crashed or a tool failed. Hard to miss.',
  },
};
