import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => Buffer.from('/usr/local/bin/claude\n')),
}));

vi.mock('child_process', () => ({
  execFile: childProcess.execFile,
  execFileSync: childProcess.execFileSync,
}));
vi.mock('fs', () => ({ existsSync: vi.fn(() => false) }));
vi.mock('../shell-path', () => ({ resolveAugmentedPath: () => '/usr/local/bin', resetAugmentedPathCache: vi.fn() }));

import { fireOpener, resetClaudeBinCache } from '../opener';

describe('fireOpener', () => {
  beforeEach(() => {
    childProcess.execFile.mockReset();
    childProcess.execFileSync.mockReturnValue(Buffer.from('/usr/local/bin/claude\n'));
    resetClaudeBinCache();
  });

  afterEach(() => vi.restoreAllMocks());

  it('denies permission prompts for unattended scheduler pings', async () => {
    childProcess.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return { stdin: { end: vi.fn() } };
    });

    await expect(fireOpener()).resolves.toEqual({ ok: true });
    expect(childProcess.execFile).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      ['-p', 'ok', '--model', 'haiku', '--permission-prompts', 'none'],
      expect.objectContaining({ timeout: 60_000 }),
      expect.any(Function),
    );
  });
});
