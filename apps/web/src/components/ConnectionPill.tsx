'use client';
import type { ConnectionState } from '@/lib/connection';
import { useI18n } from '@/lib/i18n';

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const { t, L } = useI18n();
  const map = {
    connected: { cls: 'bg-ok/20 text-ok', text: t('connected') },
    connecting: { cls: 'bg-white/10 text-off/80', text: L('接続中…', 'Connecting…') },
    reconnecting: { cls: 'bg-yellow-400/20 text-yellow-300 sw-pulse', text: t('reconnecting') },
    offline: {
      cls: 'bg-danger/20 text-danger',
      text: L('サーバーに接続できません', 'Server unreachable'),
    },
  } as const;
  const m = map[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${m.cls}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden>●</span> {m.text}
    </span>
  );
}
