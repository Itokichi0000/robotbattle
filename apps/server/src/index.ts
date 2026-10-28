import { buildServer } from './app';
import { loadEnv } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  const server = await buildServer({ env });
  const { app } = server;
  if (env.adminPasswordGenerated) {
    app.log.warn(
      `ADMIN_PASSWORD was not set. Generated a one-time development password: ${env.ADMIN_PASSWORD}`,
    );
  }
  if (env.PAYMENT_MODE === 'mock') {
    app.log.info('PAYMENT_MODE=mock: invoices are fake and no real sats can be paid.');
  }
  await app.listen({ host: env.HOST, port: env.PORT });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
