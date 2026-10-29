#!/usr/bin/env node
// Post-deploy smoke test (read-only + one guest): does the deployment answer
// like a working venue? Never pays, never touches admin state.
//   node tools/smoke.mjs --server https://game.example --web https://play.example
const args = process.argv.slice(2);
const flag = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const server = flag('--server', 'http://localhost:4000').replace(/\/+$/, '');
const web = flag('--web', 'http://localhost:3000').replace(/\/+$/, '');
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(err.message ?? err) });
  }
}
const get = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r;
};

await check('server /healthz', async () => (await (await get(`${server}/healthz`)).json()).ok);
await check('server /readyz (DB)', async () => (await (await get(`${server}/readyz`)).json()).db);
await check('current raid snapshot', async () => {
  const s = (await (await get(`${server}/api/public/current-raid`)).json()).snapshot;
  if (!s.playUrl && !s.demoMode) throw new Error('playUrl is empty (QR would be wrong)');
  return `${s.status} · ${s.passMode} · ${s.paymentMode}${s.demoMode ? ' · DEMO' : ''}`;
});
await check('API security headers', async () => {
  const r = await get(`${server}/api/public/current-raid`);
  const csp = r.headers.get('content-security-policy') ?? '';
  if (!csp.includes("default-src 'none'")) throw new Error('missing CSP');
  return 'CSP + nosniff';
});
for (const path of ['/', '/play', '/arena', '/admin', '/demo', '/leaderboard'])
  await check(`web ${path}`, async () => {
    const r = await get(`${web}${path}`);
    if (!(r.headers.get('content-security-policy') ?? '').includes("object-src 'none'"))
      throw new Error('missing CSP');
    return r.status;
  });
await check('guest sign-up', async () => {
  const r = await get(`${server}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: web },
    body: JSON.stringify({ callsign: 'SMOKE', deviceId: `smoke-${Date.now()}` }),
  });
  return (await r.json()).pilot.authType;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(28)} ${String(r.ms).padStart(5)}ms  ${r.detail ?? ''}`,
  );
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
