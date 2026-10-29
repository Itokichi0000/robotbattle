import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Content-Security-Policy (spec G3). Static pages, so no per-request nonce:
 * inline scripts stay allowed (Next's hydration payload) but everything is
 * limited to this site plus the game server (HTTP + WebSocket). Without a
 * configured URL the game server is "same host, port 4000" for any LAN host.
 */
const isDev = process.env.NODE_ENV !== 'production';
function gameServerSources(): string {
  const url = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.replace(/\/+$/, '');
  if (!url) return 'http://*:4000 https://*:4000 ws://*:4000 wss://*:4000';
  const ws = url.replace(/^http/, 'ws');
  return `${url} ${ws}`;
}
const csp = [
  "default-src 'self'",
  // wasm-unsafe-eval: the GLB decoders compile WebAssembly (it does not allow JS eval).
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self' ${gameServerSources()}${isDev ? ' ws: wss:' : ''}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
/** The offline demo file inlines its code and uses Google Fonts; nothing else. */
const demoCsp = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' blob: data:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@sats-wars/shared',
    '@sats-wars/game-engine',
    '@sats-wars/three-game',
    '@sats-wars/ui',
  ],
  turbopack: { root },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      { source: '/demo/solo.html', headers: [{ key: 'Content-Security-Policy', value: demoCsp }] },
    ];
  },
};

export default nextConfig;
