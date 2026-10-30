import { randomBytes } from 'node:crypto';
import { buildApp } from './app';
import { EnvError, loadDotEnv, parseEnv, publicBaseUrl } from './env';

loadDotEnv();

let env;
try {
  env = parseEnv(process.env, () => randomBytes(9).toString('base64url'));
} catch (err) {
  if (err instanceof EnvError) {
    console.error(`\nSATS WARS server refused to start:\n${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const { app, runtime, payments } = await buildApp(env);
await app.listen({ host: env.HOST, port: env.PORT });
runtime.start();
payments.start();

const base = publicBaseUrl(env);
const lines = [
  '',
  '  SATS WARS: EARTH DEFENSE — ONE MECH. EIGHT PILOTS.',
  `  mode       ${env.APP_MODE.toUpperCase()}${
    env.APP_MODE === 'sandbox'
      ? ' (VIRTUAL pulses only, DEMO GUEST + LNURL-auth sign-in)'
      : ' (LNbits invoices; payments stay OFF until approved in /operator)'
  }`,
  `  display    http://localhost:${env.PORT}/display/`,
  `  pilot      ${base}/pilot/   (join QR on the big screen)`,
  `  operator   http://localhost:${env.PORT}/operator/`,
  `  health     http://localhost:${env.PORT}/health`,
];
if (env.operatorPasswordGenerated) {
  lines.push(
    `  operator password (generated for this run, set OPERATOR_PASSWORD to fix it): ${env.operatorPassword}`,
  );
}
console.log(`${lines.join('\n')}\n`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.log.info({ sig }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}
