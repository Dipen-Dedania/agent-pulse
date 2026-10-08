import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every mascot's "waiting" sign says the same two words. Two of sixteen drifted
// to "Waiting for / your input" once (UX audit F-17); this pins the copy so the
// bubbles keep one voice: sign = "Need input", state name = "Waiting",
// escalation badge / notification = "Needs you".
const DIR = join(__dirname, '..');
const mascotFiles = readdirSync(DIR).filter((f) => /Mascot\.tsx$/.test(f));

describe('mascot waiting signs', () => {
  it('finds the mascot files', () => {
    expect(mascotFiles.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of mascotFiles) {
    const src = readFileSync(join(DIR, file), 'utf8');
    const hasSign = /id="flag-sign"/.test(src);
    if (!hasSign) continue;

    it(`${file} sign reads "Need / input"`, () => {
      expect(src).not.toMatch(/Waiting for/);
      expect(src).not.toMatch(/your input/);
      expect(src).toMatch(/<tspan[^>]*>Need<\/tspan>/);
      expect(src).toMatch(/<tspan[^>]*>input<\/tspan>/);
    });
  }
});
