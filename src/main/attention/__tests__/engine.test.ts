import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentState, AttentionConfig, NormalizedEvent, ToolId } from '../../../common/types';

// ── Mocks ──────────────────────────────────────────────────────────────────
// A single fake window whose webContents.send we can inspect for broadcasts.
const { sendSpy, notificationCtor } = vi.hoisted(() => ({
  sendSpy: vi.fn(),
  notificationCtor: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: sendSpy } }],
  },
  Notification: class {
    constructor(opts: unknown) { notificationCtor(opts); }
    show() {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const sendWebhookMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock('../../notifications/webhook', () => ({ sendWebhook: sendWebhookMock }));

import { AttentionEngine } from '../engine';
import type { StatusStateManager } from '../../bridge/state-manager';

// Stub state manager: capture the engine's listener so tests can emit events.
function makeStubStateManager() {
  let listener: ((e: NormalizedEvent) => void) | null = null;
  const stateManager = {
    onEvent: (l: (e: NormalizedEvent) => void) => {
      listener = l;
      return () => { listener = null; };
    },
  } as unknown as StatusStateManager;
  const emit = (toolId: ToolId, state: AgentState, taskSummary?: string) =>
    listener?.({ toolId, state, timestamp: 0, payload: { taskSummary } });
  return { stateManager, emit };
}

function cfg(partial: Partial<AttentionConfig> = {}): AttentionConfig {
  return {
    enabled: true,
    escalateAfterSeconds: 30,
    intensifyBubble: true,
    osNotification: false,
    webhooks: [],
    ...partial,
  };
}

const TOOL: ToolId = 'claude-code';

describe('AttentionEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendSpy.mockClear();
    sendWebhookMock.mockClear();
    notificationCtor.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('escalates after the threshold when a tool stays waiting', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(
      cfg({ escalateAfterSeconds: 10, webhooks: [{ id: 'w', kind: 'discord', url: 'http://x', enabled: true }] }),
      { stateManager },
    );
    engine.start();

    emit(TOOL, 'waiting', 'Fix login');
    expect(sendSpy).not.toHaveBeenCalled(); // not yet

    vi.advanceTimersByTime(10_000);

    const escalate = sendSpy.mock.calls.find((c) => c[0] === 'attention:escalate');
    expect(escalate?.[1]).toEqual({ toolId: TOOL });
    expect(sendWebhookMock).toHaveBeenCalledTimes(1);
    expect(sendWebhookMock.mock.calls[0][1].title).toContain('Claude Code');
  });

  it('does not escalate if the tool leaves waiting before the threshold', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(cfg({ escalateAfterSeconds: 10 }), { stateManager });
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(5_000);
    emit(TOOL, 'working');
    vi.advanceTimersByTime(10_000);

    expect(sendSpy.mock.calls.find((c) => c[0] === 'attention:escalate')).toBeUndefined();
  });

  it('does not re-arm on repeated waiting events (no clock reset)', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(cfg({ escalateAfterSeconds: 10 }), { stateManager });
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(8_000);
    emit(TOOL, 'waiting'); // repeat — must NOT reset the timer
    vi.advanceTimersByTime(2_000);

    expect(sendSpy.mock.calls.find((c) => c[0] === 'attention:escalate')).toBeDefined();
  });

  it('clears escalation when the tool leaves waiting after escalating', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(cfg({ escalateAfterSeconds: 10 }), { stateManager });
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(10_000);
    emit(TOOL, 'working');

    expect(sendSpy.mock.calls.find((c) => c[0] === 'attention:clear')?.[1]).toEqual({ toolId: TOOL });
  });

  it('never escalates when disabled', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(cfg({ enabled: false, escalateAfterSeconds: 10 }), { stateManager });
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(60_000);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(sendWebhookMock).not.toHaveBeenCalled();
  });

  it('fires an OS notification only when enabled', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(cfg({ escalateAfterSeconds: 10, osNotification: true }), { stateManager });
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(10_000);

    expect(notificationCtor).toHaveBeenCalledTimes(1);
  });

  it('skips disabled webhook targets', () => {
    const { stateManager, emit } = makeStubStateManager();
    const engine = new AttentionEngine(
      cfg({
        escalateAfterSeconds: 10,
        webhooks: [
          { id: 'on', kind: 'discord', url: 'http://on', enabled: true },
          { id: 'off', kind: 'slack', url: 'http://off', enabled: false },
        ],
      }),
      { stateManager },
    );
    engine.start();

    emit(TOOL, 'waiting');
    vi.advanceTimersByTime(10_000);

    expect(sendWebhookMock).toHaveBeenCalledTimes(1);
    expect(sendWebhookMock.mock.calls[0][0].id).toBe('on');
  });
});
