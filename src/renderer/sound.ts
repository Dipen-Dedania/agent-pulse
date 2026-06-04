import { BubbleSoundId } from '../common/types';

// Inactivity chimes for the bubble. 'pop' plays the bundled wav; the rest are
// synthesized on the fly with the Web Audio API (so no extra binary assets ship
// and each option stays distinct); 'none' is silent. Used both by the bubble
// (on the working→waiting transition) and the Settings preview button.

export const BUBBLE_SOUNDS: { id: BubbleSoundId; label: string; hint: string }[] = [
  { id: 'pop',     label: 'Pop',     hint: 'The classic soft pop.' },
  { id: 'chime',   label: 'Chime',   hint: 'Two-note rising bell.' },
  { id: 'ding',    label: 'Ding',    hint: 'Single bright ding.' },
  { id: 'marimba', label: 'Marimba', hint: 'Warm three-note arpeggio.' },
  { id: 'none',    label: 'None',    hint: 'Stay silent.' },
];

// Lazily-created shared context — browsers cap the number of AudioContexts and
// only allow them to start after a user gesture, so we reuse one and resume it
// on demand.
let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === 'suspended') void sharedCtx.resume();
  return sharedCtx;
}

interface Note {
  freq: number;   // Hz
  at: number;     // seconds from now
  dur: number;    // seconds
}

// Play a short sequence of notes with a quick attack and exponential decay so
// they read as plucked/struck tones rather than flat beeps.
function playNotes(notes: Note[], type: OscillatorType, peak = 0.25): void {
  const ctx = getCtx();
  if (!ctx) return;
  const start = ctx.currentTime;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = note.freq;
    const t0 = start + note.at;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
}

export function playBubbleSound(id: BubbleSoundId): void {
  try {
    switch (id) {
      case 'none':
        return;
      case 'pop': {
        const audio = new Audio('./media/pop.wav');
        audio.volume = 0.4;
        void audio.play().catch(() => {});
        return;
      }
      // E5 → B5 rising bell.
      case 'chime':
        playNotes([
          { freq: 659.25, at: 0,    dur: 0.5 },
          { freq: 987.77, at: 0.09, dur: 0.6 },
        ], 'sine', 0.22);
        return;
      // Single bright A5 ding.
      case 'ding':
        playNotes([{ freq: 880, at: 0, dur: 0.5 }], 'triangle', 0.28);
        return;
      // C5 → E5 → G5 warm arpeggio.
      case 'marimba':
        playNotes([
          { freq: 523.25, at: 0,    dur: 0.32 },
          { freq: 659.25, at: 0.07, dur: 0.32 },
          { freq: 783.99, at: 0.14, dur: 0.4 },
        ], 'sine', 0.24);
        return;
    }
  } catch {
    // Audio is best-effort — never let a chime failure bubble up.
  }
}
