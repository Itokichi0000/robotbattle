/**
 * Rehearsal wallet: approves an LNURL-auth login like a phone wallet would.
 *   pnpm --filter @swed/server lnurl-wallet <LNURL1... | https://.../api/auth/lnurl?...> [seed]
 * The seed only picks a stable test identity; this tool holds no funds and cannot pay.
 */
import { signedCallback } from '../src/testWallet';

const [input, seed = 'rehearsal-wallet'] = process.argv.slice(2);
if (!input) {
  console.error('usage: lnurl-wallet <LNURL or login URL> [seed]');
  process.exit(1);
}
const url = signedCallback(input, seed);
const res = await fetch(url);
console.log(res.status, await res.text());
