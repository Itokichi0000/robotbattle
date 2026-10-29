#!/usr/bin/env node
// Create one ADMIN_USERS entry (spec E4: 認証必須・個別アカウント).
//   pnpm admin:user <name> <viewer|operator|owner> [--no-totp]
// Asks for the password on stdin (not echoed to shell history), prints the
// line to append to ADMIN_USERS (entries joined with ";") and, unless
// --no-totp, a fresh TOTP secret with its otpauth:// URI for an authenticator
// app. Nothing is written anywhere: copy it into the server environment.
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const [name, role] = process.argv.slice(2);
const totp = !process.argv.includes('--no-totp');
if (
  !name ||
  !/^[a-z0-9_.-]{2,32}$/i.test(name) ||
  !['viewer', 'operator', 'owner'].includes(role)
) {
  console.error('usage: pnpm admin:user <name> <viewer|operator|owner> [--no-totp]');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
rl._writeToOutput = () => {}; // hide the typed password
process.stderr.write('Password (12+ characters): ');
const password = await new Promise((resolve) => rl.question('', resolve));
rl.close();
process.stderr.write('\n');
if (password.length < 12) {
  console.error('password too short (12+ characters)');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
const stored = `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
const secret = totp ? base32(randomBytes(20)) : '';
console.log(`${name}:${role}:${stored}${secret ? `:${secret}` : ''}`);
if (secret)
  console.error(
    `\nTOTP for an authenticator app (keep it private):\n  secret ${secret}\n  otpauth://totp/SATS%20WARS:${encodeURIComponent(name)}?secret=${secret}&issuer=SATS%20WARS&digits=6&period=30`,
  );
