/**
 * Idempotency keys for actions. crypto.randomUUID needs a secure context, and phones on the
 * venue LAN may load the page over plain http in rehearsal; getRandomValues works anywhere.
 */
export function newClientId(prefix = 'c'): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return `${prefix}${s}`;
}
