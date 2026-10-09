/**
 * The character picker: one tile per mascot the app ships, plus the 3D orb,
 * each showing the real rig. A radiogroup — arrow keys move the selection.
 * Wraps into rows on wide screens and scrolls sideways on phones.
 */
import { useRef, type KeyboardEvent } from 'react';
import { MASCOT_IDS, MASCOT_LABELS } from '@app/common/mascotGeometry';
import LiveCharacter from './LiveCharacter';
import type { Character } from './stateMeta';

const OPTIONS: { id: Character; label: string }[] = [
  ...MASCOT_IDS.map((id) => ({ id, label: MASCOT_LABELS[id] })),
  { id: 'orb', label: '3D Orb' },
];

interface Props {
  value: Character;
  onChange: (character: Character) => void;
}

export default function MascotStrip({ value, onChange }: Props) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].id);
    tiles.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Character"
      className="-mx-6 flex gap-1.5 overflow-x-auto px-6 pb-2 md:mx-0 md:flex-wrap md:justify-center md:overflow-visible md:px-0"
    >
      {OPTIONS.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-cards border px-1 pb-1.5 pt-1 transition-colors',
              active
                ? 'border-signal-blue bg-paper ring-2 ring-signal-blue/20'
                : 'border-transparent hover:border-mist-border hover:bg-paper',
            ].join(' ')}
          >
            <LiveCharacter character={opt.id} state="idle-active" size={48} />
            <span
              className={[
                'w-full truncate text-center text-[11px] font-medium',
                active ? 'text-midnight-navy' : 'text-slate-blue',
              ].join(' ')}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
