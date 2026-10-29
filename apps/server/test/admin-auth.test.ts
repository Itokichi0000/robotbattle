import { afterEach, describe, expect, it } from 'vitest';
import {
  base32Encode,
  hashPassword,
  parseAdminUsers,
  totpAt,
  verifyPassword,
  verifyTotp,
} from '../src/auth/admin';
import { type TestServer, auth, makeServer } from './helpers';

let s: TestServer | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
});

const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('admin accounts', () => {
  it('RFC 6238 test vector; ±30 s drift accepted, older codes refused', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpAt(SECRET, 59_000)).toBe('287082');
    expect(totpAt(SECRET, 1_111_111_109_000)).toBe('081804');
    expect(verifyTotp(SECRET, '287082', 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(SECRET, '287082', 59_000 + 90_000)).toBe(false);
    expect(verifyTotp(SECRET, '28708x', 59_000)).toBe(false);
  });

  it('scrypt hashes verify only the right password; bad entries are rejected at startup', () => {
    const h = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(() => parseAdminUsers('bob:god:scrypt$1$1$1$a$b')).toThrow();
    expect(() => parseAdminUsers('bob:owner:plaintext')).toThrow();
  });

  it('named accounts with TOTP, role checks on routes, shared login can be turned off', async () => {
    const users = [
      `olivia:owner:${hashPassword('owner-password-1')}:${SECRET}`,
      `oscar:operator:${hashPassword('operator-pass-1')}`,
      `vera:viewer:${hashPassword('viewer-password-1')}`,
    ].join(';');
    s = await makeServer({ env: { DEMO_MODE: 'true', ADMIN_USERS: users } });
    const login = (payload: Record<string, unknown>) =>
      s!.inject({ method: 'POST', url: '/api/admin/login', payload });
    const noOtp = await login({ username: 'olivia', password: 'owner-password-1' });
    expect(noOtp.statusCode).toBe(401);
    expect(noOtp.json().error).toBe('OTP_REQUIRED');
    const owner = await login({
      username: 'olivia',
      password: 'owner-password-1',
      otp: totpAt(SECRET, s.clock.now()),
    });
    expect(owner.json()).toMatchObject({ role: 'owner', actor: 'admin:olivia' });
    const op = (await login({ username: 'oscar', password: 'operator-pass-1' })).json();
    const viewer = (await login({ username: 'vera', password: 'viewer-password-1' })).json();
    expect((await login({ username: 'vera', password: 'nope' })).statusCode).toBe(401);
    expect((await login({ username: 'nobody', password: 'x' })).statusCode).toBe(401);

    const cmd = (token: string, body: Record<string, unknown>) =>
      s!.inject({ method: 'POST', url: '/api/admin/command', headers: auth(token), payload: body });
    // viewer reads, cannot act
    expect(
      (await s.inject({ url: '/api/admin/overview', headers: auth(viewer.token) })).json().me,
    ).toEqual({ actor: 'admin:vera', role: 'viewer' });
    expect((await cmd(viewer.token, { command: 'PAUSE' })).statusCode).toBe(403);
    // operator runs the event but not the money switch or the rules
    expect((await cmd(op.token, { command: 'SET_JOIN_STOPPED', stopped: true })).statusCode).toBe(
      200,
    );
    expect(
      (await cmd(op.token, { command: 'SET_PAYMENT_INTEGRATION', enabled: false })).statusCode,
    ).toBe(403);
    expect(
      (
        await s.inject({
          method: 'PUT',
          url: '/api/admin/next-raid',
          headers: auth(op.token),
          payload: { preset: 'HARD' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await cmd(owner.json().token, { command: 'SET_PAYMENT_INTEGRATION', enabled: false }))
        .statusCode,
    ).toBe(200);
    const audit = JSON.stringify(
      (await s.inject({ url: '/api/admin/audit', headers: auth(viewer.token) })).json(),
    );
    expect(audit).toContain('admin:oscar');
    expect(audit).toContain('LOGIN_FAILED');

    await s.close();
    s = await makeServer({ env: { ADMIN_USERS: users, ADMIN_SHARED_LOGIN: 'false' } });
    const shared = await s.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'test-admin-password-123' },
    });
    expect(shared.statusCode).toBe(401);
  });
});
