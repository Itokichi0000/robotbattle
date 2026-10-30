import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bech32 } from '@scure/base';

/**
 * A minimal LNURL-auth wallet for tests and rehearsals. It derives a per-domain key from a
 * seed phrase-like string (real wallets use LUD-05 BIP32 derivation) and signs k1 the way
 * LUD-04 wallets do. Never use it with real funds: it holds no funds and signs logins only.
 */

export function decodeLnurl(input: string): string {
  const s = input.trim().replace(/^lightning:/i, '');
  if (/^https?:\/\//i.test(s)) return s;
  const { words } = bech32.decode(s.toLowerCase() as `${string}1${string}`, 2_000);
  return new TextDecoder().decode(bech32.fromWords(words));
}

export function linkingKey(seed: string, domain: string): { priv: Uint8Array; pubHex: string } {
  const priv = Uint8Array.from(createHash('sha256').update(`${seed}|${domain}`).digest());
  const pubHex = Buffer.from(secp256k1.getPublicKey(priv, true)).toString('hex');
  return { priv, pubHex };
}

/** The URL a wallet would GET after the user approves the login. */
export function signedCallback(lnurlOrUrl: string, seed: string): string {
  const url = new URL(decodeLnurl(lnurlOrUrl));
  const k1 = url.searchParams.get('k1');
  if (url.searchParams.get('tag') !== 'login' || !k1)
    throw new Error('not an LNURL-auth login URL');
  const { priv, pubHex } = linkingKey(seed, url.host);
  const sig = secp256k1.sign(Uint8Array.from(Buffer.from(k1, 'hex')), priv, {
    prehash: false,
    format: 'der',
  });
  url.searchParams.set('sig', Buffer.from(sig).toString('hex'));
  url.searchParams.set('key', pubHex);
  return url.toString();
}
