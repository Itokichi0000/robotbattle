#!/usr/bin/env node
// Secret scan for tracked files (CI and pre-push). No dependencies, no network.
//   node tools/security/scan-secrets.mjs        → exit 1 on findings
// Looks for private keys, Nostr nsec keys, cloud/API tokens, LNbits keys and
// hard-coded credentials. Known test fixtures are listed in ALLOW with a reason.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |)PRIVATE KEY-----/ },
  { id: 'nostr-nsec', re: /\bnsec1[02-9ac-hj-np-z]{58}\b/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{40,}\b/ },
  {
    id: 'lnbits-key-assignment',
    re: /LNBITS_(?:INVOICE|ADMIN)_KEY\s*[=:]\s*['"]?[0-9a-f]{32}\b/i,
  },
  {
    id: 'hardcoded-credential',
    re: /\b(?:ADMIN_PASSWORD|COOKIE_SECRET|SESSION_SECRET|API_KEY|SECRET_KEY)\s*[=:]\s*['"][^'"\s$]{12,}['"]/,
  },
];

/** path → reason. Fixtures that look like secrets on purpose. */
const ALLOW = {
  'apps/server/test/helpers.ts': 'test-only admin password for the in-memory test server',
  'tests/e2e/playwright.config.ts': 'E2E admin password for the local test server',
  'tools/security/scan-secrets.mjs': 'the patterns themselves',
};

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|gif|webp|glb|blend|ico|woff2?|ttf|pdf|zip|db)$/i.test(f));

const findings = [];
for (const f of files) {
  if (ALLOW[f]) continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const r of RULES)
      if (r.re.test(line)) findings.push(`${f}:${i + 1}  [${r.id}]  ${line.trim().slice(0, 120)}`);
  });
}

if (findings.length) {
  console.error(`secret scan: ${findings.length} finding(s)`);
  for (const x of findings) console.error(`  ${x}`);
  console.error(
    'Remove the secret (and rotate it), or add a reviewed fixture to ALLOW with a reason.',
  );
  process.exit(1);
}
console.log(`secret scan: ${files.length} tracked files, no findings`);
