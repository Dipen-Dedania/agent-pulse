import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ToolId, AgentState } from '../../../../common/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock electron IPC so the component can run in jsdom
vi.mock('../../../electron.d.ts', () => ({}));

const mockElectron = {
  send: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  off: vi.fn(),
};
Object.defineProperty(window, 'electron', { value: mockElectron, writable: true });

// Mock window.matchMedia (jsdom doesn't implement it)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock framer-motion: render motion.div as a plain div, forwarding animate as data-animate
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ animate, children, ...rest }: any, ref: any) => (
      <div
        ref={ref}
        data-animate={JSON.stringify(animate)}
        data-testid="motion-div"
        {...rest}
      >
        {children}
      </div>
    )),
  },
}));

// Mock gsap: ClawdMascot drives poses through it. We don't exercise the
// animations in jsdom — a chainable no-op proxy keeps render() from crashing,
// and context().revert() is a no-op cleanup.
vi.mock('gsap', () => {
  const chain: any = new Proxy(() => chain, { get: () => () => chain });
  const gsap = {
    context: (fn: () => void) => { try { fn(); } catch { /* no-op in jsdom */ } return { revert: () => {} }; },
    to: () => chain,
    set: () => chain,
    fromTo: () => chain,
    timeline: () => chain,
    utils: { selector: () => () => [] },
  };
  return { default: gsap, ...gsap };
});

// Mock TOOL_META so we don't need image assets
vi.mock('../../../../common/toolMeta', () => ({
  TOOL_META: {
    'claude-code':    { label: 'Claude Code',    icon: '/mock-icon.png', hookInfo: {} },
    'cursor':         { label: 'Cursor',         icon: '/mock-icon.png', hookInfo: {} },
    'vscode-copilot': { label: 'GitHub Copilot', icon: '/mock-icon.png', hookInfo: {} },
    'openai-codex':   { label: 'OpenAI Codex',   icon: '/mock-icon.png', hookInfo: {} },
    'kiro':           { label: 'Kiro',           icon: '/mock-icon.png', hookInfo: {} },
  },
}));

// Mock Zustand store — we control `state` through the mock
let mockState: AgentState = 'idle';

vi.mock('../../../store/useStatusStore', () => ({
  useStatusStore: (selector: any) => {
    const store = {
      statuses: {
        'claude-code':    { toolId: 'claude-code',    state: mockState, lastUpdated: 0, activeAgents: 0 },
        'cursor':         { toolId: 'cursor',         state: mockState, lastUpdated: 0, activeAgents: 0 },
        'vscode-copilot': { toolId: 'vscode-copilot', state: mockState, lastUpdated: 0, activeAgents: 0 },
        'openai-codex':   { toolId: 'openai-codex',   state: mockState, lastUpdated: 0, activeAgents: 0 },
        'kiro':           { toolId: 'kiro',           state: mockState, lastUpdated: 0, activeAgents: 0 },
      },
      updateStatus: vi.fn(),
    };
    return selector(store);
  },
}));

// ── Re-import Bubble after mocks are set up ───────────────────────────────────
import { Bubble } from '../Bubble';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_TOOLS: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex', 'kiro'];
const ALL_STATES: AgentState[] = ['idle', 'idle-active', 'waiting', 'working', 'error'];

function renderBubble(toolId: ToolId) {
  const { container } = render(<Bubble toolId={toolId} />);
  return container;
}

function getMainMotionDiv(container: HTMLElement) {
  // The outermost motion.div wrapping the bubble sphere (has cursor-grab class)
  return container.querySelector('[data-testid="motion-div"].relative') as HTMLElement | null;
}

function getAnimateValue(container: HTMLElement): Record<string, any> | null {
  const el = getMainMotionDiv(container);
  if (!el) return null;
  try { return JSON.parse(el.getAttribute('data-animate') ?? 'null'); } catch { return null; }
}

// ── Tests: per state, all tools ───────────────────────────────────────────────

describe('Bubble animation behaviour', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe.each(ALL_TOOLS)('Tool: %s', (toolId) => {

    describe('state: idle', () => {
      beforeEach(() => { mockState = 'idle'; });

      it('has scale and opacity in animation variant', () => {
        const anim = getAnimateValue(renderBubble(toolId));
        expect(anim).not.toBeNull();
        expect(anim).toHaveProperty('scale');
        expect(anim).toHaveProperty('opacity');
      });

      it('does NOT render an orbiting ring', () => {
        const container = renderBubble(toolId);
        // Waiting ring has dotted border, working ring has dashed border
        const rings = container.querySelectorAll('[data-testid="motion-div"]:not(.relative)');
        expect(rings.length).toBe(0);
      });

      it('does NOT render an error dot', () => {
        const container = renderBubble(toolId);
        // Error dot is a div with -top-1 -right-1 positioning
        expect(container.querySelector('.-top-1.-right-1')).toBeNull();
      });
    });

    describe('state: idle-active', () => {
      beforeEach(() => { mockState = 'idle-active'; });

      it('has scale and opacity in animation variant', () => {
        const anim = getAnimateValue(renderBubble(toolId));
        expect(anim).not.toBeNull();
        expect(anim).toHaveProperty('scale');
        expect(anim).toHaveProperty('opacity');
      });

      it('does NOT render an orbiting ring', () => {
        const container = renderBubble(toolId);
        const rings = container.querySelectorAll('[data-testid="motion-div"]:not(.relative)');
        expect(rings.length).toBe(0);
      });

      it('does NOT render an error dot', () => {
        const container = renderBubble(toolId);
        expect(container.querySelector('.-top-1.-right-1')).toBeNull();
      });
    });

    describe('state: waiting', () => {
      beforeEach(() => { mockState = 'waiting'; });

      it('has opacity in animation variant (pulsing glow)', () => {
        const anim = getAnimateValue(renderBubble(toolId));
        expect(anim).toHaveProperty('opacity');
      });

      it('renders the dotted blue orbiting ring', () => {
        const container = renderBubble(toolId);
        const rings = container.querySelectorAll('[data-testid="motion-div"]:not(.relative)');
        expect(rings.length).toBe(1);
        const ring = rings[0] as HTMLElement;
        expect(ring.style.border).toMatch(/dotted/);
      });

      it('does NOT render an error dot', () => {
        expect(renderBubble(toolId).querySelector('.-top-1.-right-1')).toBeNull();
      });
    });

    describe('state: working', () => {
      beforeEach(() => { mockState = 'working'; });

      it('has scale in animation variant (pulse & grow)', () => {
        const anim = getAnimateValue(renderBubble(toolId));
        expect(anim).toHaveProperty('scale');
      });

      it('renders the dashed green orbiting ring', () => {
        const container = renderBubble(toolId);
        const rings = container.querySelectorAll('[data-testid="motion-div"]:not(.relative)');
        expect(rings.length).toBe(1);
        const ring = rings[0] as HTMLElement;
        expect(ring.style.border).toMatch(/dashed/);
      });

      it('does NOT render an error dot', () => {
        expect(renderBubble(toolId).querySelector('.-top-1.-right-1')).toBeNull();
      });
    });

    describe('state: error', () => {
      beforeEach(() => { mockState = 'error'; });

      it('has x in animation variant (shake)', () => {
        const anim = getAnimateValue(renderBubble(toolId));
        expect(anim).toHaveProperty('x');
      });

      it('renders the error dot', () => {
        const container = renderBubble(toolId);
        expect(container.querySelector('.-top-1.-right-1')).not.toBeNull();
      });

      it('does NOT render an orbiting ring', () => {
        const rings = renderBubble(toolId).querySelectorAll('[data-testid="motion-div"]:not(.relative)');
        expect(rings.length).toBe(0);
      });
    });

  });
});

// ── Tool icon is rendered ─────────────────────────────────────────────────────

describe('Bubble renders tool icon', () => {
  beforeEach(() => { mockState = 'idle'; });

  it.each(ALL_TOOLS)('renders img for %s', (toolId) => {
    const container = renderBubble(toolId);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/mock-icon.png');
  });
});

// ── Clawd mascot mode ─────────────────────────────────────────────────────────

describe('Bubble Clawd mascot mode', () => {
  beforeEach(() => { mockState = 'idle'; vi.clearAllMocks(); });
  afterEach(() => { mockElectron.invoke.mockResolvedValue(undefined); });

  const withMascotConfig = () => {
    mockElectron.invoke.mockImplementation((channel: string) => {
      if (channel === 'get-config') return Promise.resolve({ bubble: { mascotClaudeCode: true } });
      // Usage pollers feed the bars; a valid (if empty) status avoids a crash
      // on the awaited re-render once config resolves.
      if (channel.endsWith('usage:get-current')) return Promise.resolve({ state: 'unknown' });
      return Promise.resolve(undefined);
    });
  };

  it('swaps the Claude orb for the mascot SVG when enabled', async () => {
    withMascotConfig();
    const container = renderBubble('claude-code');
    await waitFor(() => expect(container.querySelector('#char')).not.toBeNull());
    // Orb icon is gone in mascot mode
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the orb for non-Claude tools even when mascot is enabled', async () => {
    withMascotConfig();
    const container = renderBubble('cursor');
    // Give the config effect a chance to apply, then confirm no mascot.
    await waitFor(() => expect(mockElectron.invoke).toHaveBeenCalledWith('get-config'));
    expect(container.querySelector('#char')).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders the orb (no mascot) for Claude when disabled', () => {
    // Default mock: invoke resolves undefined → mascot stays off.
    const container = renderBubble('claude-code');
    expect(container.querySelector('#char')).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });
});

// ── IPC handler registration ──────────────────────────────────────────────────

describe('Bubble IPC registration', () => {
  beforeEach(() => { mockState = 'idle'; vi.clearAllMocks(); });

  it.each(ALL_TOOLS)('registers status-update listener for %s', (toolId) => {
    renderBubble(toolId);
    expect(mockElectron.on).toHaveBeenCalledWith('status-update', expect.any(Function));
  });
});
