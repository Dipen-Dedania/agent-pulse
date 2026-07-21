import { describe, it, expect } from 'vitest';
import { buildWindowsResumeLine } from '../resume-terminal';

describe('buildWindowsResumeLine', () => {
  it('quote-wraps the bin and keeps the session id on argv', () => {
    const line = buildWindowsResumeLine('C:\\Program Files\\nodejs\\claude.cmd', '0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c');
    expect(line).toBe(
      'start "Agent Pulse - Resume" cmd /k "C:\\Program Files\\nodejs\\claude.cmd" --resume 0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c',
    );
  });

  it('strips embedded quotes from the bin defensively', () => {
    const line = buildWindowsResumeLine('C:\\a"b\\claude.cmd', 'sess-123abc');
    expect(line).not.toContain('a"b');
    expect(line).toContain('"C:\\ab\\claude.cmd"');
    expect(line).toContain('--resume sess-123abc');
  });
});
