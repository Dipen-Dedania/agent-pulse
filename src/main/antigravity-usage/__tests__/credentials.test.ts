import { describe, it, expect } from 'vitest';
import { extractLatestToken, extractLatestPort } from '../credentials';

const sampleArgsLine =
  '2026-04-10 17:54:47.943 [info] [LS Main] Args: --csrf_token 9242c2a8-bffd-4fb3-8ce8-b8ce216792dd ' +
  '--extension_server_port 9100 --extension_server_csrf_token f5e26972-4dc9-4ce5-9326-ffd097a8480b ' +
  '--app_data_dir antigravity --cloud_code_endpoint https://cloudcode-pa.googleapis.com';

describe('extractLatestToken', () => {
  it('returns the CSRF token from a real Args line', () => {
    expect(extractLatestToken(sampleArgsLine)).toBe('9242c2a8-bffd-4fb3-8ce8-b8ce216792dd');
  });

  it('does NOT pick up --extension_server_csrf_token even though the substring `csrf_token` matches', () => {
    // Drop the legitimate --csrf_token; only the extension variant remains.
    const adversarial =
      '2026-04-10 [info] [LS Main] Args: --extension_server_csrf_token f5e26972-4dc9-4ce5-9326-ffd097a8480b';
    expect(extractLatestToken(adversarial)).toBeNull();
  });

  it('returns the latest token when the log has multiple sessions', () => {
    const log = [
      '2026-04-10 09:00:00 [info] [LS Main] Args: --csrf_token aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'unrelated chatter...',
      '2026-04-10 15:00:00 [info] [LS Main] Args: --csrf_token bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'more chatter...',
      '2026-04-10 19:30:00 [info] [LS Main] Args: --csrf_token cccccccc-cccc-cccc-cccc-cccccccccccc',
    ].join('\n');
    expect(extractLatestToken(log)).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('returns null on a log with no Args line', () => {
    const log = '2026-04-10 [info] [LS Main] starting…\n2026-04-10 [info] [LS Main] ready';
    expect(extractLatestToken(log)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(extractLatestToken('')).toBeNull();
  });

  it('ignores UUIDs that are not next to --csrf_token (e.g. session IDs in unrelated lines)', () => {
    const log = [
      '2026-04-10 [info] sessionId=00000000-1111-2222-3333-444444444444 starting',
      '2026-04-10 [info] requestId=99999999-8888-7777-6666-555555555555 ok',
    ].join('\n');
    expect(extractLatestToken(log)).toBeNull();
  });

  it('tolerates multiple spaces / tabs between the flag and the UUID', () => {
    const log = '[info] [LS Main] Args: --csrf_token\t9242c2a8-bffd-4fb3-8ce8-b8ce216792dd';
    expect(extractLatestToken(log)).toBe('9242c2a8-bffd-4fb3-8ce8-b8ce216792dd');
  });

  it('matches a token at the start of a line (no leading space)', () => {
    const log = '--csrf_token 9242c2a8-bffd-4fb3-8ce8-b8ce216792dd --other_flag x';
    expect(extractLatestToken(log)).toBe('9242c2a8-bffd-4fb3-8ce8-b8ce216792dd');
  });

  it('correctly handles the case where extension_server_csrf_token appears BEFORE --csrf_token on the same line', () => {
    // Edge case: argv order isn't guaranteed.
    const reordered =
      '2026-04-10 [info] [LS Main] Args: --extension_server_csrf_token f5e26972-4dc9-4ce5-9326-ffd097a8480b ' +
      '--csrf_token 9242c2a8-bffd-4fb3-8ce8-b8ce216792dd --other-flag x';
    expect(extractLatestToken(reordered)).toBe('9242c2a8-bffd-4fb3-8ce8-b8ce216792dd');
  });
});

describe('extractLatestPort', () => {
  it('reads the port from a real "Port changed!" line', () => {
    const line =
      '[2026-06-04 15:08:25.532] [info]  [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:55950/';
    expect(extractLatestPort(line)).toBe(55950);
  });

  it('reads the port from a "Local:" line', () => {
    const line = '[2026-06-04 15:08:25.533] [info]    Local:       https://127.0.0.1:55950/';
    expect(extractLatestPort(line)).toBe(55950);
  });

  it('returns the most recent port when the IDE has restarted on new ports', () => {
    // This is the bug that broke usage tracking: the port is dynamic, so the
    // LATEST one wins — never an earlier session's (e.g. the old 5362).
    const log = [
      '[2026-05-21 12:15:52.837] [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:5362/',
      '[2026-05-25 15:20:39.171] [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:44847/',
      '[2026-06-04 15:08:25.532] [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:55950/',
    ].join('\n');
    expect(extractLatestPort(log)).toBe(55950);
  });

  it('returns null when no loopback URL is present', () => {
    const log = '2026-04-10 [info] [LS Main] starting…\n2026-04-10 [info] [LS Main] ready';
    expect(extractLatestPort(log)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(extractLatestPort('')).toBeNull();
  });

  it('ignores non-loopback hosts on the same port', () => {
    const log = '[info] Reloading with URL: https://10.0.0.5:55950/';
    expect(extractLatestPort(log)).toBeNull();
  });
});
