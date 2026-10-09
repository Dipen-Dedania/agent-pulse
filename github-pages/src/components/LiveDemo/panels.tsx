/**
 * The app windows the demo stages share: the terminal, the chat + backlog
 * board, the Agent Pulse Guardrails and Analytics windows, and notification
 * toasts. Pure presentation — everything they show comes from the current Frame.
 */
import type React from 'react';
import { arcColorForRemaining } from '@app/renderer/components/Bubble/quota';
import { LOGO_URL, asset, tools } from '../../data/tools';
import type { Board, Frame, GuardrailRule, TermLine, Toast } from './scenes';

const TONE_CLASS: Record<TermLine['tone'], string> = {
  cmd: 'text-[#e6edf6]',
  muted: 'text-[#8aa0b8]',
  ok: 'text-[#4ade80]',
  bad: 'text-[#f87171]',
  'chat-you': 'text-midnight-navy',
  'chat-agent': 'text-signal-blue',
};

function Line({ line }: { line: TermLine }) {
  const cls = TONE_CLASS[line.tone];
  if (!line.typed) return <div className={cls}>{line.text}</div>;
  return (
    <div className={cls}>
      <span className="demo-typed" style={{ ['--n' as string]: line.text.length }}>
        {line.text}
      </span>
    </div>
  );
}

function PermissionPrompt() {
  return (
    <div className="demo-pop mt-3 rounded-md border border-[#3b82f6]/60 bg-[#13233b] p-3 font-sans">
      <p className="mb-2.5 text-[13px] font-semibold text-[#e6edf6]">
        Allow Claude to edit files in this session?
      </p>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded border border-[#3a4f6a] px-2.5 py-1 text-[#8aa0b8]">Deny</span>
        <span className="rounded bg-[#2563eb] px-2.5 py-1 font-semibold text-paper">Allow once</span>
        <span className="rounded border border-[#3a4f6a] px-2.5 py-1 text-[#8aa0b8]">
          Allow for session
        </span>
      </div>
    </div>
  );
}

function TrafficLights() {
  return (
    <>
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
    </>
  );
}

export function TerminalPanel({ frame, sceneKey }: { frame: Frame; sceneKey: string }) {
  const busy = frame.state === 'working' || frame.state === 'waiting';
  return (
    <div className="flex h-full min-h-[240px] flex-col overflow-hidden rounded-cards bg-[#0b1626] shadow-[0_18px_40px_rgba(11,53,88,0.25)]">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <TrafficLights />
        <span className="ml-2 truncate font-mono text-[11px] text-[#8aa0b8]">~/acme-app — claude</span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-hidden p-4 font-mono text-[12px] leading-relaxed md:text-[13px]">
        {frame.lines.map((line, i) => (
          <Line key={`${sceneKey}-${i}`} line={line} />
        ))}
        {frame.prompt && <PermissionPrompt />}
        {busy && !frame.prompt && <span className="demo-caret inline-block text-[#8aa0b8]">▍</span>}
      </div>
    </div>
  );
}

function Column({ title, cards, fresh, accent }: { title: string; cards: string[]; fresh?: string; accent: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-cards bg-mist p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-blue">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        {title}
        <span className="text-steel-blue">{cards.length}</span>
      </p>
      {cards.map((card) => (
        <div
          key={card}
          className={[
            'demo-pop rounded-md border bg-paper px-2.5 py-2 text-[12px] font-medium text-midnight-navy',
            card === fresh ? 'border-signal-blue ring-2 ring-signal-blue/20' : 'border-mist-border',
          ].join(' ')}
        >
          {card}
        </div>
      ))}
    </div>
  );
}

/** `title` adds a window title bar, for stages that draw a whole desktop. */
export function BoardPanel({ frame, sceneKey, title }: { frame: Frame; sceneKey: string; title?: string }) {
  const b: Board = frame.board;
  return (
    <div className="flex h-full min-h-[240px] flex-col overflow-hidden rounded-cards border border-mist-border bg-paper shadow-[0_18px_40px_rgba(11,53,88,0.12)]">
      {title && (
        <div className="flex items-center gap-1.5 border-b border-mist-border bg-mist px-3 py-2">
          <TrafficLights />
          <span className="ml-2 truncate text-[11px] font-semibold text-slate-blue">{title}</span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="min-h-[52px] space-y-1 rounded-md bg-fog/60 px-3 py-2 font-mono text-[12px]">
          {frame.lines.map((line, i) => (
            <Line key={`${sceneKey}-${i}`} line={line} />
          ))}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-steel-blue">Backlog</p>
        <div className="grid flex-1 grid-cols-3 gap-2">
          <Column title="Todo" cards={b.todo} fresh={b.fresh} accent="#a6bbd1" />
          <Column title="In progress" cards={b.doing} accent="#16a34a" />
          <Column title="Done" cards={b.done} accent="#2563eb" />
        </div>
      </div>
    </div>
  );
}

const TOAST_ACCENT: Record<Toast['tone'], string> = {
  info: '#2563eb',
  ok: '#16a34a',
  bad: '#dc2626',
};

/** Each source's logo, and its brand colour for the accent stripe (Agent Pulse uses the outcome tone). */
const TOAST_SOURCE: Record<Toast['source'], { logo: string; brand?: string }> = {
  Slack: { logo: asset('slack.svg'), brand: '#4A154B' },
  Discord: { logo: asset('discord.svg'), brand: '#5865F2' },
  'Agent Pulse': { logo: LOGO_URL },
};

export function ToastCard({ toast }: { toast: Toast }) {
  const source = TOAST_SOURCE[toast.source];
  return (
    <div
      className="demo-toast overflow-hidden rounded-cards border border-mist-border bg-paper/95 shadow-[0_12px_32px_rgba(11,53,88,0.18)] backdrop-blur"
      style={{ borderLeft: `4px solid ${source.brand ?? TOAST_ACCENT[toast.tone]}` }}
    >
      <div className="px-3.5 py-2.5">
        <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-steel-blue">
          <img src={source.logo} alt="" width={14} height={14} draggable={false} className="h-3.5 w-3.5" />
          {toast.source}
        </p>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-snug text-midnight-navy">
          {source.brand && (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TOAST_ACCENT[toast.tone] }} />
          )}
          {toast.title}
        </p>
        <p className="text-[12px] leading-snug text-slate-blue">{toast.body}</p>
      </div>
    </div>
  );
}

/** Title bar + body shell for the Agent Pulse windows that open over the app panel. */
function AppWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="demo-pop flex h-full min-h-[240px] flex-col overflow-hidden rounded-cards border border-mist-border bg-paper shadow-[0_24px_56px_rgba(11,53,88,0.28)]">
      <div className="flex items-center gap-1.5 border-b border-mist-border bg-mist px-3 py-2">
        <TrafficLights />
        <img src={LOGO_URL} alt="" width={14} height={14} draggable={false} className="ml-2 h-3.5 w-3.5" />
        <span className="truncate text-[11px] font-semibold text-slate-blue">{title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3.5">{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-steel-blue">{children}</p>;
}

const TIER_PILL: Record<GuardrailRule['tier'], string> = {
  block: 'bg-[#fee2e2] text-[#b91c1c]',
  warn: 'bg-[#fef3c7] text-[#b45309]',
};

export function GuardrailsPanel({ frame }: { frame: Frame }) {
  const g = frame.guardrails;
  return (
    <AppWindow title="Agent Pulse — Guardrails">
      <SectionLabel>Recent triggers</SectionLabel>
      <div className="space-y-1.5">
        {g.log.length === 0 && <p className="text-[12px] text-steel-blue">Nothing blocked yet.</p>}
        {g.log.map((t) => (
          <div
            key={`${t.rule}-${t.time}`}
            className={[
              'demo-pop flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]',
              g.fresh === t.rule ? 'border-[#dc2626]/50 bg-[#fef2f2]' : 'border-mist-border bg-paper',
            ].join(' ')}
          >
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${TIER_PILL.block}`}>Blocked</span>
            <span className="font-mono font-semibold text-midnight-navy">{t.rule}</span>
            {t.custom && <span className="text-[10px] font-semibold text-ultraviolet">custom</span>}
            <span className="min-w-0 flex-1 truncate font-mono text-slate-blue">{t.cmd}</span>
            <img src={tools[0].logo} alt="" width={14} height={14} draggable={false} className="h-3.5 w-3.5" />
            <span className="tabular-nums text-steel-blue">{t.time}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <SectionLabel>Rules</SectionLabel>
        <span
          className={[
            'rounded px-2 py-0.5 text-[11px] font-semibold transition-colors',
            g.draft ? 'bg-signal-blue text-paper' : 'text-signal-blue',
          ].join(' ')}
        >
          + Add rule
        </span>
      </div>

      {g.draft && (
        <div className="demo-pop space-y-1.5 rounded-md border border-signal-blue/50 bg-fog/50 p-2.5 text-[12px]">
          <p className="flex items-center gap-2">
            <span className="w-14 text-slate-blue">Name</span>
            <span className="flex-1 rounded border border-mist-border bg-paper px-2 py-0.5 font-mono text-midnight-navy">
              <span className="demo-typed" style={{ ['--n' as string]: g.draft.id.length }}>
                {g.draft.id}
              </span>
            </span>
          </p>
          <p className="flex items-center gap-2">
            <span className="w-14 text-slate-blue">Pattern</span>
            <span className="flex-1 rounded border border-mist-border bg-paper px-2 py-0.5 font-mono text-midnight-navy">
              <span className="demo-typed demo-typed-late" style={{ ['--n' as string]: g.draft.pattern.length }}>
                {g.draft.pattern}
              </span>
            </span>
          </p>
          <p className="flex items-center gap-2">
            <span className="w-14 text-slate-blue">Action</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${TIER_PILL.block}`}>Block</span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {g.rules.map((r) => (
          <span
            key={r.id}
            className={[
              'demo-pop flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] text-midnight-navy',
              g.fresh === r.id ? 'border-signal-blue ring-2 ring-signal-blue/20' : 'border-mist-border bg-paper',
            ].join(' ')}
          >
            {r.id}
            {r.custom && <span className="font-sans text-[10px] font-semibold text-ultraviolet">custom</span>}
            <span className={`rounded px-1 font-sans text-[9px] font-bold uppercase ${TIER_PILL[r.tier]}`}>
              {r.tier}
            </span>
          </span>
        ))}
      </div>
    </AppWindow>
  );
}

const formatTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}K`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-mist-border bg-mist px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-steel-blue">{label}</p>
      <p className="text-[18px] font-bold tabular-nums text-midnight-navy">{value}</p>
    </div>
  );
}

export function AnalyticsPanel({ frame }: { frame: Frame }) {
  const u = frame.usage;
  const max = Math.max(1, ...u.bars.map((b) => b.tokens));
  const quota = frame.quota;
  return (
    <AppWindow title="Agent Pulse — Analytics">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tokens today" value={formatTokens(u.tokens)} />
        <Stat label="Est. API value" value={`$${u.value.toFixed(2)}`} />
        <Stat label="Sessions" value={String(u.sessions)} />
      </div>

      <SectionLabel>Tokens by tool</SectionLabel>
      <div className="space-y-2">
        {u.bars.map((b) => {
          const tool = tools.find((t) => t.id === b.tool);
          return (
            <div key={b.tool} className="flex items-center gap-2 text-[12px]">
              {tool && (
                <img src={tool.logo} alt="" width={16} height={16} draggable={false} className="h-4 w-4 shrink-0" />
              )}
              <span className="w-[92px] shrink-0 truncate font-medium text-midnight-navy">{tool?.name}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-fog">
                <span
                  className="block h-full rounded-full bg-signal-blue transition-[width] duration-700 ease-out"
                  style={{ width: `${(b.tokens / max) * 100}%` }}
                />
              </span>
              <span className="w-[52px] shrink-0 text-right tabular-nums text-slate-blue">{formatTokens(b.tokens)}</span>
            </div>
          );
        })}
      </div>

      {quota != null && (
        <>
          <SectionLabel>Claude Code · 5-hour window</SectionLabel>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-fog">
              <span
                className="block h-full rounded-full transition-[width,background-color] duration-700 ease-out"
                style={{ width: `${quota}%`, background: arcColorForRemaining(quota, false) }}
              />
            </span>
            <span className="w-[52px] shrink-0 text-right font-semibold tabular-nums text-midnight-navy">
              {quota}% left
            </span>
          </div>
        </>
      )}
    </AppWindow>
  );
}

/** The Agent Pulse window the frame has open over the app panel, if any. */
export function OverlayWindow({ frame }: { frame: Frame }) {
  if (frame.window === 'guardrails') return <GuardrailsPanel frame={frame} />;
  if (frame.window === 'analytics') return <AnalyticsPanel frame={frame} />;
  return null;
}
