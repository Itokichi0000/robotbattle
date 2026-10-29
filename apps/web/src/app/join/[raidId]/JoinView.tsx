'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtClock } from '@sats-wars/ui';
import { Logo } from '@/components/Logo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface RaidStatus {
  raidId: string;
  current: boolean;
  status: string;
  phase?: string;
  timeLeftMs?: number;
  gameMs?: number;
  joinOpen?: boolean;
  joinClosesAtGameMs?: number;
  passMode?: 'FREE' | 'PAID';
  ticketPriceSats?: number;
  paymentsEnabled?: boolean;
  pilotsAboard?: number;
  maxPilots?: number;
  outcome?: string | null;
}

/**
 * Join page for one raid (spec E1 /join/:raidId): is it running, how long
 * boarding stays open, and which pass applies — the 21-sat raid pass covers
 * every seat for the whole raid, sponsored and free passes give exactly the
 * same seat. Boarding itself happens in /play.
 */
export function JoinView({ raidId }: { raidId: string }) {
  const { L } = useI18n();
  const [st, setSt] = useState<RaidStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      api<RaidStatus>(`/api/raids/${encodeURIComponent(raidId)}/status`)
        .then(setSt)
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    void load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [raidId]);

  if (error)
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Logo size="sm" />
        <p>{error}</p>
        <Link
          className="sw-btn sw-focus flex items-center justify-center bg-amber text-navy"
          href="/play"
        >
          {L('いまの作戦へ', 'Go to the current raid')}
        </Link>
      </main>
    );
  if (!st) return <p className="p-6">{L('読み込み中…', 'Loading…')}</p>;
  const closesIn =
    st.joinClosesAtGameMs !== undefined && st.gameMs !== undefined
      ? Math.max(0, st.joinClosesAtGameMs - st.gameMs)
      : null;
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4" data-testid="join">
      <Link href="/" className="sw-focus self-start rounded">
        <Logo size="sm" />
      </Link>
      {!st.current ? (
        <section className="sw-panel flex flex-col gap-3 p-4">
          <h1 className="sw-display text-xl">{L('この作戦は終了しました', 'This raid is over')}</h1>
          <Link
            className="sw-btn sw-focus flex items-center justify-center bg-navy-3"
            href={`/results/${st.raidId}`}
          >
            {L('結果を見る', 'See the result')}
          </Link>
          <Link
            className="sw-btn sw-focus flex items-center justify-center bg-amber text-navy"
            href="/play"
          >
            {L('次の作戦に出撃', 'Join the next raid')}
          </Link>
        </section>
      ) : (
        <section className="sw-panel flex flex-col gap-3 p-4">
          <h1 className="sw-display text-xl">{L('出撃受付', 'Boarding')}</h1>
          <p data-testid="join-state">
            {st.joinOpen
              ? L('受付中', 'Boarding is open')
              : L(
                  '受付終了（観戦・応援は無料）',
                  'Boarding closed (watching and cheering are free)',
                )}
            {st.joinOpen && closesIn !== null && st.status === 'LIVE' && (
              <span className="ml-2 text-amber">
                {L(`締切まで ${fmtClock(closesIn)}`, `closes in ${fmtClock(closesIn)}`)}
              </span>
            )}
          </p>
          <p className="text-sm text-muted">
            {L(
              `搭乗 ${st.pilotsAboard}/${st.maxPilots}人`,
              `${st.pilotsAboard}/${st.maxPilots} pilots aboard`,
            )}
          </p>
          <div className="rounded-lg border border-line p-3 text-sm">
            {st.passMode === 'FREE' ? (
              <p>🎟 {L('無料イベント：そのまま搭乗できます', 'Free event: board right away')}</p>
            ) : (
              <>
                <p className="font-bold">
                  ⚡{' '}
                  {L(`出撃パス ${st.ticketPriceSats} sats`, `Raid pass ${st.ticketPriceSats} sats`)}
                </p>
                <p>
                  {L(
                    '1回払えばこの作戦の間、全部の席で何回でも出撃できます。払った額で強くはなりません。',
                    'Pay once: every seat, as many sorties as you like this raid. Paying never makes you stronger.',
                  )}
                </p>
                <p className="mt-1">
                  🎫{' '}
                  {L(
                    'スポンサーパス（運営配布のコード）でも同じ席に乗れます。',
                    'A sponsored pass (code from the organisers) gives the very same seat.',
                  )}
                </p>
                {!st.paymentsEnabled && (
                  <p className="mt-1 text-amber">
                    {L(
                      'いまは新しい支払いを受け付けていません',
                      'New payments are paused right now',
                    )}
                  </p>
                )}
              </>
            )}
          </div>
          <Link
            className="sw-btn sw-focus flex items-center justify-center bg-amber text-lg text-navy"
            href="/play"
            data-testid="join-go"
          >
            🚀 {st.joinOpen ? L('搭乗する', 'Board now') : L('観戦・応援する', 'Watch and cheer')}
          </Link>
          <p className="text-xs text-muted">
            {L(
              '賞金・換金・払い戻し・抽選はありません。観戦と応援は無料です。',
              'No prizes, cash-out, refunds or lotteries. Watching and cheering are free.',
            )}
          </p>
        </section>
      )}
    </main>
  );
}
