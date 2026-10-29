'use client';
import { useEffect, useState } from 'react';
import type { PilotProfile } from '@sats-wars/shared';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(e: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<{
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }>;
}

/**
 * Optional Nostr link (shown only when the server enables it). The browser
 * extension (NIP-07) signs a one-time challenge; the npub can then be printed
 * on the license card. Not a login, no posting, no zaps, no relays.
 */
export function NostrLink({
  pilot,
  onChanged,
}: {
  pilot: PilotProfile;
  onChanged: () => Promise<void>;
}) {
  const { L } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [ext, setExt] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void api<{ nostr?: boolean }>('/api/auth/modes')
      .then((m) => setEnabled(!!m.nostr))
      .catch(() => setEnabled(false));
    setExt(typeof (window as { nostr?: Nip07 }).nostr?.signEvent === 'function');
  }, []);
  if (!enabled) return null;

  const link = async () => {
    setMsg(null);
    const nostr = (window as { nostr?: Nip07 }).nostr;
    if (!nostr) return;
    try {
      const c = await api<{ challenge: string; domain: string; kind: number }>(
        '/api/me/nostr/challenge',
        { body: {} },
      );
      const event = await nostr.signEvent({
        kind: c.kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['challenge', c.challenge],
          ['domain', c.domain],
        ],
        content: '',
      });
      await api('/api/me/nostr/link', { body: { event } });
      await onChanged();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : L('署名されませんでした', 'Not signed'));
    }
  };
  const unlink = async () => {
    await api('/api/me/nostr', { method: 'DELETE' });
    await onChanged();
  };
  const show = async (v: boolean) => {
    await api('/api/me', { method: 'PATCH', body: { nostrShowOnCard: v } });
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="nostr-link">
      <p className="font-bold">{L('Nostr 連携（任意）', 'Nostr link (optional)')}</p>
      <p className="text-xs text-muted">
        {L(
          'ライセンス画像に npub を載せるためだけの連携です。ログインや投稿・Zap には使いません。',
          'Only to print your npub on the license card. Never used to log in, post or zap.',
        )}
      </p>
      {pilot.nostr.npub ? (
        <>
          <code className="break-all text-xs">{pilot.nostr.npub}</code>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pilot.nostr.showOnCard}
              onChange={(e) => void show(e.target.checked)}
            />
            {L('ライセンス画像に npub を載せる', 'Print my npub on the license card')}
          </label>
          <button type="button" className="sw-btn bg-navy-3" onClick={() => void unlink()}>
            {L('連携を解除', 'Unlink')}
          </button>
        </>
      ) : ext ? (
        <button type="button" className="sw-btn bg-navy-3" onClick={() => void link()}>
          {L('Nostr拡張機能で署名して連携', 'Link with my Nostr extension')}
        </button>
      ) : (
        <p className="text-xs text-muted">
          {L('NIP-07 対応の拡張機能が見つかりません。', 'No NIP-07 browser extension found.')}
        </p>
      )}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
