import { describe, it, expect } from 'vitest';
import { buildWindowsRefineLine } from '../refine-terminal';

describe('buildWindowsRefineLine', () => {
  it('quote-wraps the bin and starts a fresh plan-mode session on argv', () => {
    const line = buildWindowsRefineLine('C:\\Program Files\\nodejs\\claude.cmd', '0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c');
    expect(line).toBe(
      'start "Agent Pulse - Refine" cmd /k "C:\\Program Files\\nodejs\\claude.cmd" --session-id 0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c --permission-mode plan',
    );
  });

  it('strips embedded quotes from the bin defensively', () => {
    const line = buildWindowsRefineLine('C:\\a"b\\claude.cmd', '11111111-2222-3333-4444-555555555555');
    expect(line).not.toContain('a"b');
    expect(line).toContain('"C:\\ab\\claude.cmd"');
    expect(line).toContain('--session-id 11111111-2222-3333-4444-555555555555 --permission-mode plan');
  });
});
