/**
 * The compact demo stage, used where the laptop would be too small to read:
 * a menu bar with a clock, an app panel (terminal, or chat + backlog board,
 * replaced by the Agent Pulse window when one is open — there's no room to
 * stack them), the agent's bubble, toast notifications, and the
 * waiting-escalation edge glow. Pure presentation — everything it shows comes from the current Frame.
 */
import LiveCharacter from './LiveCharacter';
import { STATE_META, type Character } from './stateMeta';
import { BoardPanel, OverlayWindow, TerminalPanel, ToastCard } from './panels';
import type { Frame } from './scenes';

interface Props {
  frame: Frame;
  /** Changes per chapter so typed lines and cards re-animate. */
  sceneKey: string;
  character: Character;
}

export default function DesktopStage({ frame, sceneKey, character }: Props) {
  const meta = STATE_META[frame.state];

  return (
    <div
      className="relative overflow-hidden border border-mist-border"
      style={{
        borderRadius: 'var(--radius-mockup)',
        boxShadow: 'var(--shadow-sm-3)',
        background:
          'radial-gradient(120% 90% at 85% 10%, rgba(130,71,245,0.16), transparent 60%), radial-gradient(90% 80% at 0% 100%, rgba(0,153,255,0.16), transparent 60%), #f3f6fb',
      }}
      aria-hidden="true"
    >
      {/* Menu bar */}
      <div className="flex items-center justify-between border-b border-mist-border/70 bg-paper/60 px-4 py-1.5 text-[11px] font-medium text-slate-blue backdrop-blur">
        <span>Your desktop</span>
        <span className="tabular-nums">{frame.clock}</span>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-[1fr_190px] md:p-7">
        {/* The agent's bubble — first on mobile so it's never below the fold of the stage */}
        <div className="flex flex-col items-center justify-center gap-2 md:order-2">
          <LiveCharacter character={character} state={frame.state} size={124} quota={frame.quota} />
          <span className="flex items-center gap-1.5 rounded-badges bg-paper/80 px-3 py-1 text-[12px] font-medium text-midnight-navy shadow-sm backdrop-blur">
            <span
              className="h-2 w-2 rounded-full transition-colors duration-300"
              style={{ background: meta.dot }}
            />
            Claude Code · {meta.label}
          </span>
        </div>

        <div className="min-w-0 md:order-1">
          {frame.window ? (
            <OverlayWindow frame={frame} />
          ) : frame.panel === 'board' ? (
            <BoardPanel frame={frame} sceneKey={sceneKey} />
          ) : (
            <TerminalPanel frame={frame} sceneKey={sceneKey} />
          )}
        </div>
      </div>

      {/* Notification toast */}
      <div className="pointer-events-none absolute bottom-4 right-4 w-[min(310px,calc(100%-2rem))]">
        {frame.toast && <ToastCard key={frame.toast.title} toast={frame.toast} />}
      </div>

      {/* Waiting-escalation edge glow */}
      <div
        className={[
          'pointer-events-none absolute inset-0 transition-opacity duration-500',
          frame.glow ? 'demo-edge-glow opacity-100' : 'opacity-0',
        ].join(' ')}
        style={{ borderRadius: 'inherit' }}
      />
    </div>
  );
}
