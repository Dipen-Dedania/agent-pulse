import { describe, it, expect } from 'vitest';
import { AgentState } from '../../../../common/types';
import {
  WAVE_PRESETS,
  WAVEFORM_WINDOW_MS,
  WAVEFORM_SAMPLE_MS,
  WAVEFORM_SAMPLES,
  WAVEFORM_BOX,
  nextDrive,
  waveSample,
  DRIVE_KICK,
  DRIVE_DECAY,
} from '../WaveformTrace';
import { BubbleSize } from '../../../../common/types';

// Unit coverage for the state→shape mapping, the activity drive, and the
// sample generator. The canvas draw loop needs a real 2D context (absent in
// jsdom), so it's verified by eye in the app; here we lock the pure logic that
// decides what the trace looks like.

const ALL_STATES: AgentState[] = ['idle', 'idle-active', 'waiting', 'working', 'error'];

const SIZES: BubbleSize[] = ['small', 'medium', 'large'];

describe('waveform trace window', () => {
  it('spans exactly the hardcoded 20s window', () => {
    expect(WAVEFORM_WINDOW_MS).toBe(20_000);
    expect(WAVEFORM_SAMPLES * WAVEFORM_SAMPLE_MS).toBe(WAVEFORM_WINDOW_MS);
  });

  it('keeps enough px per sample for the zigzag to read at every size', () => {
    // Below ~1.5px per sample the up-down smears into a solid block. The disc's
    // chord is much narrower than the old wide lane, which is why the window
    // shortened — shortening it rather than coarsening WAVEFORM_SAMPLE_MS keeps
    // DRIVE_DECAY (locked below) valid. The old lane's floor was 1.4.
    for (const size of SIZES) {
      expect(WAVEFORM_BOX[size].trace / WAVEFORM_SAMPLES).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe('waveform disc geometry', () => {
  it('draws the trace inside the disc at every size', () => {
    // The trace band is a centred chord, so its corners must fall within the
    // circle or the trace clips: (trace/2)² + (band/2)² ≤ (disc/2)².
    for (const size of SIZES) {
      const { disc, band, trace } = WAVEFORM_BOX[size];
      const r = disc / 2;
      expect((trace / 2) ** 2 + (band / 2) ** 2).toBeLessThanOrEqual(r ** 2);
    }
  });

  it('uses the same disc and logo sizes as the orb it replaces', () => {
    // Mirrors ORB_DIMENSIONS (orb / icon) in Bubble.tsx. If these drift, a
    // waveform bubble stops being footprint-identical to the other fills and
    // the window sizing in bubble-manager no longer fits it.
    expect(SIZES.map((s) => WAVEFORM_BOX[s].disc)).toEqual([38, 48, 60]);
    expect(SIZES.map((s) => WAVEFORM_BOX[s].logo)).toEqual([19, 24, 30]);
  });

  it('leaves drawable amplitude in every band', () => {
    // The draw loop reserves 3px top and bottom (halfH = band/2 − 3), so a band
    // that got too short would flatten the trace into its own baseline.
    for (const size of SIZES) {
      expect(WAVEFORM_BOX[size].band / 2 - 3).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('WaveformTrace presets', () => {
  it('defines a preset for every agent state', () => {
    for (const s of ALL_STATES) {
      expect(WAVE_PRESETS[s]).toBeDefined();
    }
  });

  it('colour-codes the states the way the rest of the app does', () => {
    // idle is monochrome ink and follows the theme.
    expect(WAVE_PRESETS.idle.color(true)).not.toEqual(WAVE_PRESETS.idle.color(false));
    // working reads green (green dominates), error reads red.
    const [wr, wg, wb] = WAVE_PRESETS.working.color(true);
    expect(wg).toBeGreaterThan(wr);
    expect(wg).toBeGreaterThan(wb);
    const [er, eg, eb] = WAVE_PRESETS.error.color(true);
    expect(er).toBeGreaterThan(eg);
    expect(er).toBeGreaterThan(eb);
  });
});

describe('nextDrive', () => {
  it('kicks up on a tool call and decays without one', () => {
    const kicked = nextDrive(0, true);
    expect(kicked).toBeCloseTo(DRIVE_KICK, 5);
    expect(nextDrive(kicked, false)).toBeLessThan(kicked);
  });

  it('never exceeds 1 however many tool calls land', () => {
    let drive = 0;
    for (let i = 0; i < 50; i++) drive = nextDrive(drive, true);
    expect(drive).toBeLessThanOrEqual(1);
  });

  it('decays at the same rate in real time whatever the sample rate is', () => {
    // DRIVE_DECAY is per tick, so re-tuning WAVEFORM_SAMPLE_MS without
    // re-deriving it would silently change how long a burst stays visible.
    // This locks the wall-clock rate: ~0.6x per second.
    const perSecond = DRIVE_DECAY ** (1000 / WAVEFORM_SAMPLE_MS);
    expect(perSecond).toBeCloseTo(0.6, 2);
  });

  it('decays to effectively flat within ~8s of the last tool call', () => {
    const ticks = Math.ceil(8_000 / WAVEFORM_SAMPLE_MS);
    let drive = 1;
    for (let i = 0; i < ticks; i++) drive = nextDrive(drive, false);
    expect(drive).toBeLessThan(0.02);
  });
});

describe('waveSample', () => {
  const magnitudes = (state: AgentState, drive: number) =>
    Array.from({ length: 24 }, (_, i) => Math.abs(waveSample(state, drive, i)));

  it('flatlines when idle, whatever the drive', () => {
    for (const m of magnitudes('idle', 1)) expect(m).toBe(0);
  });

  it('holds a steady plateau while waiting on the user', () => {
    const held = magnitudes('waiting', 0);
    // Every sample identical and well clear of the baseline — the trace jumps
    // up and stays there rather than oscillating.
    expect(new Set(held).size).toBe(1);
    expect(held[0]).toBeGreaterThan(0.5);
    // ...and always on the same side, so it reads as a held spike.
    expect(waveSample('waiting', 0, 0)).toBe(waveSample('waiting', 0, 1));
  });

  it('grows the working amplitude with tool-call activity', () => {
    const quiet = magnitudes('working', 0);
    const busy = magnitudes('working', 1);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(busy)).toBeGreaterThan(mean(quiet));
    // Even between tool calls a working agent stays off the baseline, so
    // "working" never gets confused with "idle".
    expect(mean(quiet)).toBeGreaterThan(0);
  });

  it('alternates sign for the busy states so the trace zigzags', () => {
    expect(waveSample('working', 1, 0)).toBeGreaterThan(0);
    expect(waveSample('working', 1, 1)).toBeLessThan(0);
  });

  it('spikes on the sample that carried a tool call', () => {
    expect(Math.abs(waveSample('working', 0.2, 4, true)))
      .toBeGreaterThan(Math.abs(waveSample('working', 0.2, 4, false)));
  });

  it('keeps every sample inside the drawable -1…1 range', () => {
    for (const state of ALL_STATES) {
      for (const drive of [0, 0.5, 1]) {
        for (let i = 0; i < 40; i++) {
          const v = waveSample(state, drive, i, i % 3 === 0);
          expect(v).toBeGreaterThanOrEqual(-1);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives a stable value for a sample already captured', () => {
    // History must not shimmer as the buffer scrolls.
    expect(waveSample('working', 0.4, 7)).toBe(waveSample('working', 0.4, 7));
  });
});
