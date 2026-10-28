/**
 * Game server base URL. Defaults to the same host on port 4000 so phones on
 * the venue LAN work without configuration. Override with
 * NEXT_PUBLIC_GAME_SERVER_URL for deployments behind a reverse proxy.
 */
export function gameServerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}
