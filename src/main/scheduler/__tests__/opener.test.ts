import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  default: childProcess,
  ...childProcess,
}));
vi.mock('../../shell-path', () => ({
  resolveAugmentedPath: () => '/mock/bin',
  resetAugmentedPathCache: vi.fn(),
}));

import { fireOpener, resetClaudeBinCache } from '../opener';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe.each(['darwin', 'linux', 'win32'] as const)('fireOpener (%s)', (platform) => {
  const isWin = platform === 'win32';
  const bin = isWin ? 'C:\\Program Files\\Claude\\claude.cmd' : '/usr/local/bin/claude';

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe');
    childProcess.execFile.mockReset();
    childProcess.execFileSync.mockReset();
    childProcess.execFileSync.mockReturnValue(Buffer.from(`${bin}\n`));
    resetClaudeBinCache();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetClaudeBinCache();
  });

  it('denies permission prompts for unattended scheduler pings', async () => {
    const endStdin = vi.fn();
    childProcess.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return { stdin: { end: endStdin } };
    });

    await expect(fireOpener()).resolves.toEqual({ ok: true });
    expect(childProcess.execFileSync).toHaveBeenCalledExactlyOnceWith(
      isWin ? 'where' : 'which',
      ['claude'],
      expect.objectContaining({ env: expect.objectContaining({ PATH: '/mock/bin' }) }),
    );
    expect(childProcess.execFile).toHaveBeenCalledWith(
      isWin ? 'C:\\Windows\\System32\\cmd.exe' : bin,
      isWin
        ? ['/d', '/s', '/c', '""C:\\Program Files\\Claude\\claude.cmd" -p ok --model haiku --permission-prompts none"']
        : ['-p', 'ok', '--model', 'haiku', '--permission-prompts', 'none'],
      expect.objectContaining({ timeout: 60_000, windowsHide: true, windowsVerbatimArguments: isWin }),
      expect.any(Function),
    );
    expect(endStdin).toHaveBeenCalledOnce();
  });
});
