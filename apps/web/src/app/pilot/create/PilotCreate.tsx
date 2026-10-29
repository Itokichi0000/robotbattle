'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MeResponse, PassportResponse } from '@sats-wars/shared';
import { AVATAR_PRESETS } from '@sats-wars/shared';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LicenseCard } from '../../passport/LicenseCard';
import { deviceId } from '../../play/session';

/**
 * License issue (spec E1 /pilot/create): callsign, avatar and what the big
 * screen may show, then the license card. Works for a new guest (no wallet)
 * and for a pilot who is already logged in; Lightning login is optional.
 */
export function PilotCreate() {
  const { L } = useI18n();
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [callsign, setCallsign] = useState('');
  const [avatar, setAvatar] = useState<string>('standard');
  const [showName, setShowName] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);
  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<MeResponse>('/api/me');
      setMe(m);
      setCallsign(m.pilot.callsign.startsWith('PILOT-') ? '' : m.pilot.callsign);
      setAvatar(m.pilot.avatar);
      setShowName(m.pilot.showNameOnArena);
      setShowAvatar(m.pilot.showAvatarOnArena);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!me)
        await api('/api/auth/guest', { body: { callsign: callsign.trim(), deviceId: deviceId() } });
      await api('/api/me', {
        method: 'PATCH',
        body: {
          ...(callsign.trim() ? { callsign: callsign.trim() } : {}),
          avatar,
          showNameOnArena: showName,
          showAvatarOnArena: showAvatar,
        },
      });
      setPassport(await api<PassportResponse>('/api/me/passport'));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (me === undefined) return <p className="p-6">{L('読み込み中…', 'Loading…')}</p>;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4" data-testid="pilot-create">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      <h1 className="sw-display text-2xl">{L('パイロットライセンス発行', 'Pilot license')}</h1>
      {!passport ? (
        <form
          className="sw-panel flex flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void issue();
          }}
        >
          <label className="text-sm font-bold" htmlFor="pc-callsign">
            {L('コールサイン（20文字まで・省略可）', 'Callsign (up to 20, optional)')}
          </label>
          <input
            id="pc-callsign"
            className="sw-focus min-h-12 rounded-lg border border-line bg-navy px-3 text-lg"
            value={callsign}
            maxLength={20}
            onChange={(e) => setCallsign(e.target.value)}
            autoComplete="nickname"
            data-testid="pc-callsign"
          />
          <p className="text-xs text-muted">
            {L('本名や連絡先は入れないでね。', 'No real names or contact details.')}
          </p>
          <label className="flex items-center gap-2 text-sm" htmlFor="pc-avatar">
            {L('アバター', 'Avatar')}
            <select
              id="pc-avatar"
              className="sw-focus min-h-11 rounded-lg border border-line bg-navy px-2"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
            >
              {AVATAR_PRESETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showName}
              onChange={(e) => setShowName(e.target.checked)}
            />
            {L(
              '大画面にコールサインを表示する（初期はオフ＝PILOT-番号）',
              'Show my callsign on the big screen (off = PILOT-number)',
            )}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAvatar}
              onChange={(e) => setShowAvatar(e.target.checked)}
            />
            {L(
              '大画面のコックピットに装飾を表示する',
              'Show my decorations in the big-screen cockpit',
            )}
          </label>
          <button
            type="submit"
            className="sw-btn bg-amber text-lg text-navy"
            disabled={busy}
            data-testid="pc-issue"
          >
            🪪{' '}
            {me
              ? L('ライセンスを更新', 'Update license')
              : L('ゲストでライセンス発行', 'Issue as guest')}
          </button>
          {!me && (
            <Link
              className="sw-btn sw-focus flex items-center justify-center bg-navy-3"
              href="/auth/lightning?next=/pilot/create"
            >
              ⚡{' '}
              {L('Lightningウォレットで発行（記録を守りやすい）', 'Issue with a Lightning wallet')}
            </Link>
          )}
          <p className="text-xs text-muted">
            {L(
              'Lightning認証は「鍵を持っていること」の確認で、本人確認ではありません。秘密鍵やシードを求めることはありません。',
              'Lightning login proves you hold a key — it is not an identity check. We never ask for keys or seeds.',
            )}
          </p>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <p className="sw-panel p-3 font-bold" role="status" data-testid="pc-issued">
            ✅ {L('ライセンスを発行しました', 'License issued')}
          </p>
          <LicenseCard
            data={passport}
            onChanged={async () => setPassport(await api('/api/me/passport'))}
          />
          <Link
            className="sw-btn sw-focus flex items-center justify-center bg-amber text-lg text-navy"
            href="/play"
          >
            🚀 {L('出撃する', 'Go fly')}
          </Link>
        </>
      )}
    </main>
  );
}
