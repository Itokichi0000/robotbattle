import { storage } from '@/lib/api';

/**
 * Random per-device id. The server keeps only its hash and uses it to hand the
 * same guest pilot (and their history) back after a cleared cookie.
 */
export function deviceId(): string {
  let id = storage.get('sw.device');
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.set('sw.device', id);
  }
  return id;
}
