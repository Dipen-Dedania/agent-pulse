import { useEffect, useState } from 'react';
import { tools } from '../data/tools';
import LiveCharacter, { FallbackOrb } from './LiveDemo/LiveCharacter';
import {
  STATE_META,
  prefersReducedMotion,
  type AgentState,
  type Character,
} from './LiveDemo/stateMeta';

interface Row {
  tool: { name: string; logo: string };
  /** The tool's home mascot in the app (see MASCOT_HOME); omit for the plain logo bubble. */
  character?: Character;
  /** States this row cycles through, offset per row so they never sync up. */
  states: AgentState[];
}

// tools[0] = Claude Code, tools[1] = Cursor, tools[3] = OpenAI Codex
const ROWS: Row[] = [
  { tool: tools[0], character: 'clawd', states: ['working', 'waiting', 'working', 'idle-active'] },
  { tool: tools[1], character: 'knight', states: ['waiting', 'working', 'idle-active', 'working'] },
  { tool: tools[3], states: ['idle-active', 'idle', 'working', 'waiting'] },
];

const STEP_MS = 3600;

/** Single bubble row inside the mockup card */
function BubbleRow({ row, tick }: { row: Row; tick: number }) {
  const state = row.states[tick % row.states.length];
  const { label, dot } = STATE_META[state];

  return (
    <div className="flex items-center gap-4">
      {row.character ? (
        <LiveCharacter character={row.character} state={state} size={72} />
      ) : (
        <div className="flex items-center justify-center shrink-0" style={{ width: 72, height: 72 }}>
          <FallbackOrb state={state} size={72} logo={row.tool.logo} />
        </div>
      )}

      {/* Label + status dot */}
      <div className="min-w-0">
        <p
          className="text-midnight-navy font-semibold truncate"
          style={{ fontSize: 14, lineHeight: 1.4 }}
        >
          {row.tool.name}
        </p>
        <span className="flex items-center gap-1.5 mt-0.5">
          <span
            className="inline-block rounded-full shrink-0 transition-colors duration-300"
            style={{ width: 7, height: 7, background: dot }}
            aria-hidden
          />
          <span className="text-slate-blue" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {label}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Hero-section product card: three agents, each shown as its real in-app
 * mascot acting out a state that changes every few seconds.
 * The entire card gently floats on `animate-float`.
 * Decorative — marked aria-hidden at the top level.
 */
export default function BubbleMockup() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => setTick((t) => t + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="animate-float motion-reduce:animate-none"
      aria-hidden="true"
      // Keep the float transform layer isolated so it doesn't affect layout
      style={{ willChange: 'transform' }}
    >
      <div
        className="bg-paper rounded-mockup flex flex-col gap-3 p-6"
        style={{ boxShadow: 'var(--shadow-sm-2)', minWidth: 280 }}
      >
        {/* Subtle card header */}
        <p
          className="text-steel-blue font-medium uppercase tracking-wider"
          style={{ fontSize: 11, lineHeight: 1.5 }}
        >
          Agent Status
        </p>

        {ROWS.map((row) => (
          <BubbleRow key={row.tool.name} row={row} tick={tick} />
        ))}

        {/* Thin divider + footer hint */}
        <div className="border-t border-mist-border pt-3">
          <p
            className="text-steel-blue text-center"
            style={{ fontSize: 11, lineHeight: 1.5 }}
          >
            localhost:4242 · 3 agents connected
          </p>
        </div>
      </div>
    </div>
  );
}
