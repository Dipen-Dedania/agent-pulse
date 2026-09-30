import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AgentState, BubbleConfig, BubbleSize, BubbleStackPosition, BubbleSoundId, BubbleFillMode, BubbleQuotaStyle, DisplayInfo, MascotId, ToolId } from '../../../common/types';
import { BUBBLE_SOUNDS, playBubbleSound } from '../../sound';
import { TOOL_META } from '../../../common/toolMeta';
import { MASCOT_HINTS, MASCOT_HOME, MASCOT_IDS, MASCOT_LABELS, mascotFor } from '../../../common/mascotGeometry';
import { STATE_COLORS } from '../../../common/stateColors';
import { MercMascot } from '../Bubble/MercMascot';
import { Button, GlassToggle, Modal, Segmented, Select, SelectOption, Tooltip } from '../Shared';

// Every agent gets a mascot row, in TOOL_META order. Any mascot can be assigned
// to any agent; MASCOT_HOME supplies the vendor default the master switch uses.
const MASCOT_TOOLS = Object.keys(TOOL_META) as ToolId[];

const MASCOT_OPTIONS: SelectOption<MascotId>[] = [
  { value: 'none', label: MASCOT_LABELS.none },
  ...MASCOT_IDS.map((id) => ({ value: id, label: MASCOT_LABELS[id] })),
];

interface Props {
  config: BubbleConfig;
  onChange: (partial: Partial<BubbleConfig>) => void;
}

const SIZE_OPTIONS: { id: BubbleSize; label: string; orb: number }[] = [
  { id: 'small',  label: 'Small',  orb: 22 },
  { id: 'medium', label: 'Medium', orb: 30 },
  { id: 'large',  label: 'Large',  orb: 40 },
];

const FILL_OPTIONS: { id: BubbleFillMode; label: string }[] = [
  { id: 'glass', label: 'Glass' },
  { id: 'solid', label: 'Solid' },
  { id: 'particle', label: '3D Orb' },
  { id: 'waveform', label: 'Waveform' },
];

const QUOTA_STYLE_OPTIONS: { value: BubbleQuotaStyle; label: string; hint: string }[] = [
  { value: 'bars', label: 'Bars', hint: 'One bar per quota window, stacked below the bubble.' },
  { value: 'arc', label: 'Arc', hint: 'A ring around the bubble showing one window. Frees the vertical space the bars use.' },
];

// Preview for the Waveform fill: flatline → a burst of tool calls → flatline →
// the held spike that means "waiting on you". A horizontal trace needs width,
// not a 30px round swatch — which is why the option row is a 2×2 grid.
const WaveformSwatch: React.FC = () => (
  <svg viewBox='0 0 72 22' width={72} height={22} aria-hidden focusable='false'>
    <line x1='0' y1='11' x2='72' y2='11' stroke='currentColor' strokeOpacity='0.2' strokeWidth='1' />
    <polyline
      points='0,11 10,11 13,4 15,18 17,6 19,16 21,8 23,14 25,11 36,11 42,11 44,3 72,3'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinejoin='round'
      strokeLinecap='round'
    />
  </svg>
);

// Quick-pick fill colors. White covers the common "dark logo, dark desktop"
// case; the rest are neutral backdrops. Any color is reachable via the picker.
const FILL_SWATCHES = ['#ffffff', '#f1f5f9', '#1e293b', '#000000'];

const POSITION_OPTIONS: { id: BubbleStackPosition; label: string }[] = [
  { id: 'top-left',     label: 'Top left' },
  { id: 'top-right',    label: 'Top right' },
  { id: 'bottom-left',  label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

// A small monitor mock-up with a clickable bubble dot in each corner so the
// stack anchor reads at a glance. When the user has drag-placed the stack
// (custom anchor), no corner lights up — picking one snaps the stack back.
const PositionPicker: React.FC<{
  value: BubbleStackPosition;
  hasCustomAnchor: boolean;
  onChange: (next: BubbleStackPosition) => void;
}> = ({ value, hasCustomAnchor, onChange }) => {
  const cornerClass: Record<BubbleStackPosition, string> = {
    'top-left':     'top-2 left-2',
    'top-right':    'top-2 right-2',
    'bottom-left':  'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };
  return (
    <div className='glass-secondary w-full max-w-[280px] aspect-[16/10]'>
      {/* faux taskbar */}
      <div className='absolute bottom-0 left-0 right-0 h-2 bg-control/50' />
      {hasCustomAnchor && (
        <span className='absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest text-muted font-semibold pointer-events-none'>
          Custom
        </span>
      )}
      {POSITION_OPTIONS.map((opt) => {
        const active = !hasCustomAnchor && value === opt.id;
        return (
          <Tooltip key={opt.id} content={opt.label}>
            <button
              onClick={() => onChange(opt.id)}
              aria-label={opt.label}
              className={`absolute ${cornerClass[opt.id]} w-5 h-5 rounded-full cursor-pointer transition-all ${
                active
                  ? 'bg-blue-500 ring-2 ring-blue-300/60 scale-110'
                  : 'bg-control-strong/70 hover:bg-control-strong'
              }`}
            />
          </Tooltip>
        );
      })}
    </div>
  );
};

// Friendly monitor name: the OS label when it has one, else a stable
// left-to-right ordinal ("Display 2").
const displayName = (d: DisplayInfo, index: number) =>
  d.label && d.label.trim().length > 0 ? d.label : `Display ${index + 1}`;

// A to-scale map of the user's monitor arrangement (same coordinate space the
// OS display settings show), each screen a clickable tile. Mirrors the
// PositionPicker look so the two placement controls read as one family.
const DisplayPicker: React.FC<{
  displays: DisplayInfo[];
  selectedId: number | null;
  hasCustomAnchor: boolean;
  onChange: (id: number) => void;
}> = ({ displays, selectedId, hasCustomAnchor, onChange }) => {
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const spanX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)) - minX;
  const spanY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height)) - minY;
  const scale = Math.min(280 / spanX, 150 / spanY);

  // A saved display that's currently unplugged highlights nothing; the
  // primary tile lights up instead, matching where bubbles actually are.
  const activeId = displays.some((d) => d.id === selectedId)
    ? selectedId
    : displays.find((d) => d.primary)?.id;

  return (
    <div
      className='relative'
      style={{ width: Math.round(spanX * scale), height: Math.round(spanY * scale) }}
    >
      {displays.map((d, i) => {
        const active = !hasCustomAnchor && d.id === activeId;
        return (
          <Tooltip key={d.id} content={`${displayName(d, i)} — ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (primary)' : ''}`}>
            <button
              onClick={() => onChange(d.id)}
              className={`absolute rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                active
                  ? 'bg-blue-500/25 border-blue-400/80 text-strong'
                  : 'bg-inset/60 border-edge-strong/80 text-muted hover:border-edge-strong hover:text-primary'
              }`}
              style={{
                left: Math.round((d.bounds.x - minX) * scale),
                top: Math.round((d.bounds.y - minY) * scale),
                width: Math.round(d.bounds.width * scale) - 2,
                height: Math.round(d.bounds.height * scale) - 2,
              }}
            >
              <span className='text-sm font-semibold'>{i + 1}</span>
              {d.primary && (
                <span className='absolute bottom-1 text-[9px] uppercase tracking-wider text-faint'>
                  Primary
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export const BubbleSection: React.FC<Props> = ({ config, onChange }) => {
  const selectedPositionLabel =
    POSITION_OPTIONS.find((p) => p.id === config.stackPosition)?.label ?? config.stackPosition;

  const [mascotModalOpen, setMascotModalOpen] = useState(false);

  // Mascot master state: "all on" means every agent with a home mascot shows
  // one (whichever the user picked). The map is sent whole on every change —
  // the main process merges BubbleConfig shallowly, so a partial map would
  // drop the other agents' assignments.
  const mascots = config.mascots ?? {};
  const homeTools = MASCOT_TOOLS.filter((t) => MASCOT_HOME[t]);
  const allMascotsOn = homeTools.every((t) => mascotFor(mascots, t) !== null);
  const setMascot = (toolId: ToolId, id: MascotId) => {
    const next = { ...mascots };
    if (id === 'none') delete next[toolId];
    else next[toolId] = id;
    onChange({ mascots: next });
  };
  // Master toggle: if any home agent is bare, give every home agent its own
  // character (keeping explicit picks); otherwise clear every assignment.
  const toggleAllMascots = () => {
    if (allMascotsOn) { onChange({ mascots: {} }); return; }
    const next = { ...mascots };
    for (const t of homeTools) if (!mascotFor(next, t)) next[t] = MASCOT_HOME[t]!;
    onChange({ mascots: next });
  };

  // Connected monitors, kept live across hotplug while Settings is open.
  // Sorted left-to-right so the "Display N" ordinals stay stable on re-push.
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    const sort = (list: DisplayInfo[]) =>
      [...list].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    window.electron.invoke('screen:get-displays').then((list: DisplayInfo[]) => setDisplays(sort(list)));
    const onDisplaysChanged = (_event: unknown, list: DisplayInfo[]) => setDisplays(sort(list));
    window.electron.on('screen:displays-changed', onDisplaysChanged);
    return () => window.electron.off('screen:displays-changed', onDisplaysChanged);
  }, []);

  const selectedDisplayIndex = displays.findIndex(
    (d) => (config.displayId != null && d.id === config.displayId) ||
           (config.displayId == null && d.primary),
  );
  const selectedDisplay = displays[selectedDisplayIndex] ?? displays.find((d) => d.primary);

  return (
    <>
    <motion.section
      whileHover={{ scale: 1.003 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className='glass-primary p-6 flex flex-col gap-7'
    >
      <div>
        <h2 className='text-lg font-bold text-strong'>Bubble appearance</h2>
        <p className='text-sm text-muted mt-1'>
          Tune how the status bubbles look and sound. Changes apply instantly and persist across restarts.
        </p>
      </div>

      {/* ── Show bubbles (master visibility) ─────────────────────────────── */}
      <div className='glass-secondary flex items-center justify-between gap-4 px-4 py-3'>
        <div className='min-w-0'>
          <p className='text-sm font-medium text-strong'>Show bubbles</p>
          <p className='text-xs text-muted mt-0.5'>
            Hide every bubble from your screen while keeping tracking, usage, and guardrails fully active.
            The hooks keep running — only the floating bubbles disappear.
          </p>
        </div>
        <button
          onClick={() => onChange({ hidden: !config.hidden })}
          aria-pressed={!config.hidden}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.hidden ? 'toggle-glass-off' : 'bg-blue-500'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.hidden ? 'translate-x-0' : 'translate-x-5'
            }`}
          />
        </button>
      </div>

      {/* ── Mascots (opens modal) ────────────────────────────────────────── */}
      <div className='glass-secondary flex items-center justify-between gap-4 px-4 py-3'>
        <div className='min-w-0 flex items-center gap-3'>
          {/* Overlapped agent logos as a visual anchor. */}
          <div className='flex shrink-0'>
            {homeTools.map((t, i) => (
              <img
                key={t}
                src={TOOL_META[t].icon}
                alt=''
                aria-hidden
                className={`w-6 h-6 rounded-full ring-2 ring-black/20 object-contain bg-control/40 ${i > 0 ? '-ml-2' : ''} ${mascotFor(mascots, t) ? '' : 'opacity-40 grayscale'}`}
              />
            ))}
          </div>
          <div className='min-w-0'>
            <p className='text-sm font-medium text-strong'>Mascots</p>
            <p className='text-xs text-muted mt-0.5'>
              Pick an animated mascot for each agent
            </p>
          </div>
        </div>
        <Button variant='secondary' size='sm' onClick={() => setMascotModalOpen(true)}>
          Customize ›
        </Button>
      </div>

      {/* ── Size ──────────────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Size</p>
        <p className='text-xs text-muted -mt-1'>
          Scales the whole bubble — orb, icon, and the usage bars beneath it (width &amp; thickness).
        </p>
        <div className='flex gap-3'>
          {SIZE_OPTIONS.map((opt) => {
            const active = config.size === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ size: opt.id })}
                className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50 text-strong'
                    : 'bg-inset/40 border-edge/60 text-muted hover:border-edge-strong hover:text-primary'
                }`}
              >
                <span
                  className='rounded-full'
                  style={{
                    width: opt.orb,
                    height: opt.orb,
                    background: active
                      ? 'radial-gradient(circle, rgba(59,130,246,0.9) 0%, rgba(59,130,246,0.25) 100%)'
                      : 'radial-gradient(circle, rgba(148,163,184,0.7) 0%, rgba(148,163,184,0.2) 100%)',
                    border: '1.5px solid rgba(255,255,255,0.25)',
                  }}
                />
                <span className='text-sm font-medium'>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Fill ─────────────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Fill</p>
        <p className='text-xs text-muted -mt-1'>
          Frosted glass blends with your desktop, but a dark logo (e.g. Cursor) can vanish over a dark
          window. A solid fill paints a consistent backdrop so every logo stays clearly visible.
          Waveform fills the orb with a live trace of the last 20 seconds of activity, over a dimmed
          agent logo.
        </p>
        <p className='text-xs text-faint -mt-1'>
          Agents with a mascot enabled above keep their mascot — a mascot always wins over the fill.
        </p>
        {/* 2×2 rather than one row of four: four side-by-side buttons squeeze
            the preview swatches, and Waveform's is a horizontal trace. */}
        <div className='grid grid-cols-2 gap-3'>
          {FILL_OPTIONS.map((opt) => {
            const active = (config.fillMode ?? 'glass') === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ fillMode: opt.id })}
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50 text-strong'
                    : 'bg-inset/40 border-edge/60 text-muted hover:border-edge-strong hover:text-primary'
                }`}
              >
                {opt.id === 'waveform' ? (
                  <WaveformSwatch />
                ) : (
                  <span
                    className='rounded-full'
                    style={{
                      width: 30,
                      height: 30,
                      background:
                        opt.id === 'solid'
                          ? config.fillColor || '#ffffff'
                          : opt.id === 'particle'
                            ? 'transparent'
                            : 'radial-gradient(circle, rgba(148,163,184,0.55) 0%, rgba(128,128,128,0.06) 100%)',
                      backdropFilter: opt.id === 'glass' ? 'blur(6px)' : undefined,
                      // 3D Orb previews itself as a dotted ring; glass/solid use a solid rim.
                      border:
                        opt.id === 'particle'
                          ? '2px dotted rgba(255,255,255,0.55)'
                          : '1.5px solid rgba(255,255,255,0.25)',
                    }}
                  />
                )}
                <span className='text-sm font-medium'>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {(config.fillMode ?? 'glass') === 'solid' && (
          <div className='flex flex-wrap items-center gap-2 mt-1'>
            {FILL_SWATCHES.map((c) => {
              const active = (config.fillColor || '#ffffff').toLowerCase() === c.toLowerCase();
              return (
                <Tooltip key={c} content={c}>
                  <button
                    onClick={() => onChange({ fillColor: c })}
                    aria-label={`Fill color ${c}`}
                    className={`w-7 h-7 rounded-full cursor-pointer transition-transform border-[1.5px] border-white/25 light:border-black/20 ${
                      active ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-glass scale-110' : 'hover:scale-105'
                    }`}
                    style={{ background: c }}
                  />
                </Tooltip>
              );
            })}
            <label className='flex items-center gap-2 ml-1 text-xs text-muted cursor-pointer'>
              <input
                type='color'
                value={/^#[0-9a-f]{6}$/i.test(config.fillColor || '') ? config.fillColor : '#ffffff'}
                onChange={(e) => onChange({ fillColor: e.target.value })}
                className='w-7 h-7 rounded-lg bg-transparent border border-edge/70 cursor-pointer p-0'
                aria-label='Custom fill color'
              />
              Custom
            </label>
          </div>
        )}
      </div>

      {/* ── Quota display ────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Quota display</p>
        <p className='text-xs text-muted -mt-1'>
          How each agent's remaining subscription credit is drawn. Bars stack one thin bar per quota
          window beneath the bubble. The arc rings the bubble instead, which costs no vertical space
          but only fits one window — for agents that track several (Claude's 5-hour and 7-day,
          Copilot's quotas, Antigravity's per-model), the arc shows the one most likely to block you
          and the rest stay in the hover tooltip.
        </p>
        <p className='text-xs text-faint -mt-1'>
          Agents with a mascot enabled above keep their bars — there's no orb for an arc to ring.
        </p>
        <Segmented
          options={QUOTA_STYLE_OPTIONS}
          value={config.quotaStyle ?? 'bars'}
          onChange={(next) => onChange({ quotaStyle: next as BubbleQuotaStyle })}
          size='md'
          className='self-start'
        />
      </div>

      {/* ── Opacity ──────────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Opacity</p>
          <span className='text-xs font-medium text-body tabular-nums'>
            {Math.round((config.opacity ?? 1) * 100)}%
          </span>
        </div>
        <p className='text-xs text-muted -mt-1'>
          How see-through the whole bubble is — orb or mascot, usage bars, and badges all dim together.
        </p>
        <input
          type='range'
          min={30}
          max={100}
          step={5}
          value={Math.round((config.opacity ?? 1) * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          aria-label='Bubble opacity'
          className='w-full accent-blue-500 cursor-pointer'
        />
      </div>

      {/* ── Monitor ──────────────────────────────────────────────────────── */}
      {displays.length > 1 && (
        <div className='flex flex-col gap-3'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Monitor</p>
          <p className='text-xs text-muted -mt-1'>
            Choose which screen the bubble stack lives on. The layout mirrors your OS display arrangement.
          </p>
          <DisplayPicker
            displays={displays}
            selectedId={config.displayId}
            hasCustomAnchor={config.anchor != null}
            onChange={(id) => onChange({ displayId: id, anchor: null })}
          />
          <p className='text-xs text-faint'>
            {config.anchor != null
              ? 'Bubbles follow where you dragged them. Pick a monitor to snap the stack back to its corner on that screen.'
              : selectedDisplay
                ? `Bubbles appear on ${displayName(selectedDisplay, displays.indexOf(selectedDisplay))}${selectedDisplay.primary ? ' (primary)' : ''}. If it's unplugged, they move to the primary display until it returns.`
                : ''}
          </p>
        </div>
      )}

      {/* ── Stack position ───────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Default stack position</p>
        <div className='flex flex-col sm:flex-row items-start gap-5'>
          <PositionPicker
            value={config.stackPosition}
            hasCustomAnchor={config.anchor != null}
            onChange={(next) => onChange({ stackPosition: next, anchor: null })}
          />
          <div className='grid grid-cols-2 gap-2'>
            {POSITION_OPTIONS.map((opt) => {
              const active = config.anchor == null && config.stackPosition === opt.id;
              return (
                <Button
                  key={opt.id}
                  variant={active ? 'primary' : 'secondary'}
                  size='md'
                  onClick={() => onChange({ stackPosition: opt.id, anchor: null })}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </div>
        <p className='text-xs text-faint'>
          {config.anchor != null
            ? 'Bubbles stay where you dragged them — on any monitor — and stack toward that screen\'s middle. Pick a corner to snap back to a preset.'
            : `Bubbles anchor to the ${selectedPositionLabel.toLowerCase()} corner and stack toward the screen's middle. Drag a bubble to place the stack anywhere, on any monitor.`}
        </p>
      </div>

      {/* ── Inactivity sound ─────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Inactivity notification sound</p>
        <p className='text-xs text-muted -mt-1'>
          Plays when an agent finishes and flips to “waiting for input.”
        </p>
        <div className='flex flex-col gap-2'>
          {BUBBLE_SOUNDS.map((sound) => {
            const active = config.sound === sound.id;
            return (
              <div
                key={sound.id}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50'
                    : 'bg-inset/40 border-edge/60'
                }`}
              >
                <button
                  onClick={() => onChange({ sound: sound.id })}
                  className='flex-1 flex items-center gap-3 text-left cursor-pointer'
                >
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      active ? 'border-blue-400' : 'border-edge-strong'
                    }`}
                  >
                    {active && <span className='w-2 h-2 rounded-full bg-blue-400' />}
                  </span>
                  <span>
                    <span className={`text-sm font-medium ${active ? 'text-strong' : 'text-body'}`}>
                      {sound.label}
                    </span>
                    <span className='text-xs text-faint ml-2'>{sound.hint}</span>
                  </span>
                </button>
                {sound.id !== 'none' && (
                  <Button
                    variant='secondary'
                    size='sm'
                    onClick={() => playBubbleSound(sound.id)}
                    className='shrink-0'
                    aria-label={`Preview ${sound.label}`}
                  >
                    ▶ Preview
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.section>

    <AnimatePresence>
      {mascotModalOpen && (
        <MascotModal
          mascots={mascots}
          onPick={setMascot}
          allOn={allMascotsOn}
          onToggleAll={toggleAllMascots}
          onClose={() => setMascotModalOpen(false)}
        />
      )}
    </AnimatePresence>
    </>
  );
};

// ── Mascot showreel ──────────────────────────────────────────────────────────
// Live demo for the Mascots modal's master card: Merc acts out every agent
// state in turn, so the card shows what "pose tracks state" means instead of
// describing it. The caption names the state currently being acted.
const SHOWREEL: { state: AgentState; label: string }[] = [
  { state: 'idle-active', label: 'Idle (active)' },
  { state: 'working', label: 'Working' },
  { state: 'waiting', label: 'Waiting' },
  { state: 'error', label: 'Error' },
  { state: 'idle', label: 'Idle' },
];
const SHOWREEL_STEP_MS = 3500;

const MascotShowreel: React.FC = () => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((n) => (n + 1) % SHOWREEL.length), SHOWREEL_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  const { state, label } = SHOWREEL[step];
  return (
    <div className='min-w-0 flex items-center gap-4'>
      <div className='w-[72px] h-[72px] shrink-0 flex items-end justify-center'>
        <MercMascot state={state} width={72} />
      </div>
      <div className='min-w-0'>
        <p className='text-sm font-medium text-strong'>Animated mascots</p>
        <p className={'text-xs mt-0.5 font-medium ' + STATE_COLORS[state].textClass}>{label}</p>
      </div>
    </div>
  );
};

// ── Mascots modal ────────────────────────────────────────────────────────────
// Master "Animated mascots" switch + one row per agent with a mascot picker.
// Shares BubbleConfig via onPick; no local persistence. Matches the
// AddRuleModal backdrop idiom.
const MascotModal: React.FC<{
  mascots: BubbleConfig['mascots'];
  onPick: (toolId: ToolId, id: MascotId) => void;
  allOn: boolean;
  onToggleAll: () => void;
  onClose: () => void;
}> = ({ mascots, onPick, allOn, onToggleAll, onClose }) => {
  return (
    <Modal eyebrow='Bubble appearance' title='Mascots' onClose={onClose}>
      {/* Master switch */}
      <div className='glass-secondary shrink-0 flex items-center justify-between gap-4 px-4 py-3'>
        <MascotShowreel />
        <GlassToggle
          checked={allOn}
          onChange={onToggleAll}
          size='lg'
          label='Animated mascots (all agents)'
        />
      </div>

      {/* Per-agent rows */}
      <div className='flex flex-col gap-2 shrink-0'>
        {MASCOT_TOOLS.map((toolId) => {
          const picked = mascots?.[toolId] ?? 'none';
          const hint = picked === 'none' ? 'Glass orb' : MASCOT_HINTS[picked];
          return (
            <div key={toolId} className='glass-secondary shrink-0 flex items-center justify-between gap-3 px-4 py-2.5'>
              <div className='min-w-0 flex items-center gap-3'>
                <img
                  src={TOOL_META[toolId].icon}
                  alt=''
                  aria-hidden
                  className='w-6 h-6 rounded-full object-contain bg-control/40 shrink-0'
                />
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-strong truncate'>{TOOL_META[toolId].label}</p>
                  <p className='text-[11px] text-muted truncate'>{hint}</p>
                </div>
              </div>
              <Select<MascotId>
                value={picked}
                options={MASCOT_OPTIONS}
                onChange={(id) => onPick(toolId, id)}
                className='w-36 px-3 py-1.5 text-sm'
                ariaLabel={`Mascot for ${TOOL_META[toolId].label}`}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
