import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// credentials.ts resolves ~/.codex/auth.json at import time, so the fake home
// has to exist before the module loads — hence vi.hoisted + vi.mock('os').
const { fakeHome } = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs');
  const nodeOs = require('os') as typeof import('os');
  const nodePath = require('path') as typeof import('path');
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ap-codex-creds-'));
  return { fakeHome: dir };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const homedir = () => fakeHome;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

import { decodeJwtExpiry, readAccessToken } from '../credentials';

const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload: object) => `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

const authFile = path.join(fakeHome, '.codex', 'auth.json');
function writeAuth(contents: object | string) {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, typeof contents === 'string' ? contents : JSON.stringify(contents));
}

describe('decodeJwtExpiry', () => {
  it('returns exp in ms for a well-formed token', () => {
    expect(decodeJwtExpiry(jwt({ exp: 1_791_000_000, iat: 1 }))).toBe(1_791_000_000_000);
  });

  it('returns null when exp is missing, non-numeric, or non-positive', () => {
    expect(decodeJwtExpiry(jwt({ iat: 1 }))).toBeNull();
    expect(decodeJwtExpiry(jwt({ exp: 'soon' }))).toBeNull();
    expect(decodeJwtExpiry(jwt({ exp: 0 }))).toBeNull();
  });

  it('returns null for non-JWT strings and undecodable payloads', () => {
    expect(decodeJwtExpiry('sk-not-a-jwt')).toBeNull();
    expect(decodeJwtExpiry('a.b')).toBeNull();
    expect(decodeJwtExpiry('a.!!!.c')).toBeNull();
    expect(decodeJwtExpiry(`a.${Buffer.from('not json').toString('base64url')}.c`)).toBeNull();
  });
});

describe('readAccessToken', () => {
  beforeEach(() => {
    fs.rmSync(path.join(fakeHome, '.codex'), { recursive: true, force: true });
  });

  it('reports missing when there is no auth file', async () => {
    const out = await readAccessToken();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('missing');
  });

  it('returns the token and the JWT expiry', async () => {
    const token = jwt({ exp: 1_791_000_000 });
    writeAuth({ tokens: { access_token: token, id_token: 'x' }, last_refresh: '2026-10-05T07:11:52Z' });
    const out = await readAccessToken();
    expect(out).toEqual({ ok: true, token, expiresAt: 1_791_000_000_000 });
  });

  it('falls back to last_refresh + 10 days when the token is opaque', async () => {
    writeAuth({ tokens: { access_token: 'opaque-token' }, last_refresh: '2026-10-05T07:11:52.000Z' });
    const out = await readAccessToken();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.expiresAt).toBe(Date.parse('2026-10-05T07:11:52.000Z') + 10 * 24 * 3600 * 1000);
  });

  it('omits expiresAt when neither source is usable', async () => {
    writeAuth({ accessToken: 'opaque-token' });
    const out = await readAccessToken();
    expect(out).toEqual({ ok: true, token: 'opaque-token' });
  });

  it('reports malformed JSON and a missing token', async () => {
    writeAuth('{not json');
    const bad = await readAccessToken();
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('malformed');

    writeAuth({ tokens: {} });
    const none = await readAccessToken();
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.detail).toContain('access_token missing');
  });
});
