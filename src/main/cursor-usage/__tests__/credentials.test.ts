import { describe, it, expect } from 'vitest';
import { buildCredentials } from '../credentials';

// Build a JWT whose payload carries the given `sub` (no real signing needed).
function jwtWithSub(sub: string): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub })}.sig`;
}

describe('buildCredentials (cursor)', () => {
  it('builds the WorkosCursorSessionToken cookie from the JWT sub', () => {
    const token = jwtWithSub('google-oauth2|abc123');
    const res = buildCredentials({
      accessToken: token,
      membershipType: 'free',
      email: 'dev@example.com',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).toBe(token);
    expect(res.userId).toBe('google-oauth2|abc123');
    // `::` is URL-encoded to %3A%3A and the pipe in the sub to %7C.
    expect(res.cookie).toBe(`WorkosCursorSessionToken=google-oauth2%7Cabc123%3A%3A${token}`);
    expect(res.membershipType).toBe('free');
    expect(res.email).toBe('dev@example.com');
  });

  it('works without optional membership/email', () => {
    const res = buildCredentials({ accessToken: jwtWithSub('auth0|x') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.userId).toBe('auth0|x');
    expect(res.membershipType).toBeUndefined();
    expect(res.email).toBeUndefined();
  });

  it('returns malformed when the access token is absent', () => {
    expect(buildCredentials({})).toMatchObject({ ok: false, reason: 'malformed' });
    expect(buildCredentials({ email: 'dev@example.com' })).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('returns malformed when the token has no decodable sub', () => {
    expect(buildCredentials({ accessToken: 'not.a.jwt' })).toMatchObject({ ok: false, reason: 'malformed' });
    // valid base64 segment but no `sub` claim
    const noSub = `x.${Buffer.from(JSON.stringify({ foo: 1 })).toString('base64')}.y`;
    expect(buildCredentials({ accessToken: noSub })).toMatchObject({ ok: false, reason: 'malformed' });
  });
});
