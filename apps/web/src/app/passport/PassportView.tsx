'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { PassportResponse } from '@sats-wars/shared';
import { AVATAR_PRESETS, ROLE_LABELS, TITLE_LABELS } from '@sats-wars/shared';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { LicenseCard } from './LicenseCard';
import { NostrLink } from './NostrLink';
import { Icon, ROLE_ICON } from '@sats-wars/ui';

/**
 * Pilot license + SATS PASSPORT: rank, titles and raid history. Everything
 * here is cosmetic; none of it changes power in a raid.
 */
export function PassportView() {
  const { L } = useI18n();
  const [data, setData] = useState<PassportResponse | null>(null);
  const [state, setState] = useState<'loading' | 'anon' | 'ok'>('loading');
  const [callsign, setCallsign] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<PassportResponse>('/api/me/passport');
      setData(d);
      setCallsign(d.pilot.callsign);
      setState('ok');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('anon');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api('/api/me', { method: 'PATCH', body });
      setMsg(L('保存しました', 'Saved'));
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };
  const exportData = async () => {
    const d = await api<unknown>('/api/me/export', { body: {} });
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sats-wars-pilot.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const remove = async () => {
    if (
      !window.confirm(
        L(
          'パイロット記録を削除します。元に戻せません。よろしいですか？',
          'Delete your pilot record? This cannot be undone.',
        ),
      )
    )
      return;
    await api('/api/me', { method: 'DELETE' });
    window.location.href = '/';
  };
  const logout = async (all: boolean) => {
    await api(all ? '/api/auth/logout-all' : '/api/auth/logout', { body: {} });
    window.location.href = '/';
  };

  if (state === 'loading') return <p className="p-6">{L('読み込み中…', 'Loading…')}</p>;
  if (state === 'anon' || !data)
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Logo size="sm" />
        <p>{L('まだパイロット登録していません。', 'You are not a pilot yet.')}</p>
        <Link
          className="sw-btn sw-focus flex items-center justify-center bg-amber text-navy"
          href="/play"
        >
          {L('搭乗する', 'Board now')}
        </Link>
      </main>
    );

  const p = data.pilot;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4" data-testid="passport">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      <section className="sw-panel relative overflow-hidden p-5" data-testid="license">
        <div
          className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-gradient-to-br from-amber/40 to-teal/40 blur-xl"
          aria-hidden="true"
        />
        <p className="text-xs tracking-[0.3em] text-muted">
          SATS WARS · EARTH DEFENSE · PILOT LICENSE
        </p>
        <h1 className="sw-display mt-1 text-3xl" data-testid="passport-callsign">
          {p.callsign}
        </h1>
        <p className="mt-1 font-bold text-amber">
          {L(data.rankNameJa, data.rankNameEn)}
          {data.nextRankAt !== null && (
            <span className="ml-2 text-xs text-muted">
              {L(`次の階級まで あと${data.nextRankAt}pt`, `${data.nextRankAt} pts to next rank`)}
            </span>
          )}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-xs text-muted">{L('出撃', 'Sorties')}</dt>
            <dd className="text-2xl font-black">{p.sorties}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{L('防衛成功', 'Victories')}</dt>
            <dd className="text-2xl font-black">{p.victories}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{L('認証', 'Login')}</dt>
            <dd className="text-sm font-bold">
              {p.lightningLinked ? '⚡ Lightning' : L('ゲスト', 'Guest')}
            </dd>
          </div>
        </dl>
        {p.titles.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1" aria-label={L('称号', 'Titles')}>
            {p.titles.map((t) => (
              <li key={t} className="rounded-full bg-navy-3 px-2 py-0.5 text-xs font-bold">
                🏅 {TITLE_LABELS[t] ? L(TITLE_LABELS[t].ja, TITLE_LABELS[t].en) : t}
              </li>
            ))}
          </ul>
        )}
      </section>

      <LicenseCard data={data} onChanged={load} />

      <section className="sw-panel p-4">
        <h2 className="font-black">
          {L('出撃記録（SATS PASSPORT）', 'Raid history (SATS PASSPORT)')}
        </h2>
        {data.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {L('まだ記録はありません。出撃してスタンプを集めよう！', 'No stamps yet. Fly a raid!')}
          </p>
        ) : (
          <ol className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.history.map((h) => (
              <li
                key={h.raidId}
                className={`rounded-xl border-2 p-2 text-center text-sm ${h.outcome === 'SUCCEEDED' ? 'border-amber' : 'border-line'}`}
              >
                <Link href={`/results/${h.raidId}`} className="block">
                  <div className="text-2xl">{h.outcome === 'SUCCEEDED' ? '🏆' : '🛡'}</div>
                  <div className="font-bold">
                    <Icon name={ROLE_ICON[h.role]} className="mr-1 inline size-4 align-[-0.15em]" />
                    {L(ROLE_LABELS[h.role].ja, ROLE_LABELS[h.role].en)}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(h.endedAt).toLocaleDateString()}
                  </div>
                  <div className="text-xs">
                    {L(`スコア ${Math.round(h.score)}`, `Score ${Math.round(h.score)}`)}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="sw-panel flex flex-col gap-3 p-4">
        <h2 className="font-black">{L('プロフィール', 'Profile')}</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ callsign });
          }}
        >
          <input
            className="sw-focus min-h-11 flex-1 rounded-lg border border-line bg-navy px-3"
            value={callsign}
            maxLength={20}
            onChange={(e) => setCallsign(e.target.value)}
            aria-label={L('コールサイン', 'Callsign')}
          />
          <button
            type="submit"
            className="sw-btn shrink-0 bg-teal px-4 whitespace-nowrap text-navy"
          >
            {L('変更', 'Save')}
          </button>
        </form>
        <label className="flex items-center gap-2 text-sm">
          {L('アバター', 'Avatar')}
          <select
            className="sw-focus min-h-11 rounded-lg border border-line bg-navy px-2"
            value={p.avatar}
            onChange={(e) => void patch({ avatar: e.target.value })}
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
            checked={p.showNameOnArena}
            onChange={(e) => void patch({ showNameOnArena: e.target.checked })}
          />
          {L(
            '大画面にコールサインを表示する（オフなら PILOT-番号）',
            'Show my callsign on the big screen (PILOT-number otherwise)',
          )}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.showAvatarOnArena}
            onChange={(e) => void patch({ showAvatarOnArena: e.target.checked })}
            data-testid="show-avatar"
          />
          {L(
            '大画面のコックピットに自分の装飾（ヘルメット等）を表示する',
            'Show my helmet and decorations in the big-screen cockpit',
          )}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.reducedMotion}
            onChange={(e) => void patch({ reducedMotion: e.target.checked })}
          />
          {L('動きを減らす', 'Reduce motion')}
        </label>
        {msg && <p className="text-sm text-muted">{msg}</p>}
      </section>

      <section className="sw-panel flex flex-col gap-2 p-4 text-sm">
        <h2 className="font-black">{L('アカウント', 'Account')}</h2>
        {!p.lightningLinked && (
          <Link
            className="sw-btn sw-focus flex items-center justify-center bg-navy-3"
            href="/auth/lightning?link=1&next=/passport"
          >
            ⚡{' '}
            {L(
              'Lightningウォレットを連携して記録を守る',
              'Link a Lightning wallet to keep your records',
            )}
          </Link>
        )}
        <NostrLink pilot={p} onChanged={load} />
        <button type="button" className="sw-btn bg-navy-3" onClick={() => void exportData()}>
          ⬇ {L('自分のデータをダウンロード', 'Download my data')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="sw-btn flex-1 bg-navy-3"
            onClick={() => void logout(false)}
          >
            {L('ログアウト', 'Log out')}
          </button>
          <button
            type="button"
            className="sw-btn flex-1 bg-navy-3"
            onClick={() => void logout(true)}
          >
            {L('全端末からログアウト', 'Log out everywhere')}
          </button>
        </div>
        <button type="button" className="sw-btn bg-danger/80" onClick={() => void remove()}>
          {L('パイロット記録を削除', 'Delete my pilot record')}
        </button>
      </section>
    </main>
  );
}
