'use client';
import { PHASE_LABELS, STATUS_LABELS } from '@sats-wars/shared';
import { JapanMapMini, RaidHeader, raidView } from '@sats-wars/ui';
import { usePilotsOnline, useRaid, useRaidConnection, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function LandingLive() {
  const { L, locale } = useI18n();
  const conn = useRaidConnection('spectator');
  const snap = useRaid(conn);
  const online = usePilotsOnline(conn);
  useTicker(500);
  if (!snap || !conn) return <div className="sw-panel p-6 text-center text-off/70">{L('作戦情報を読み込み中…', 'Loading raid…')}</div>;
  const view = raidView(snap, conn.gameNow());
  const label = snap.status === 'LIVE' ? PHASE_LABELS[snap.phase] : STATUS_LABELS[snap.status];
  return (
    <div className="sw-panel flex flex-col gap-2 p-4" data-testid="landing-live">
      <span className="font-black">{L(label.ja, label.en)}</span>
      <RaidHeader raid={snap} view={view} locale={locale} compact />
      <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
      <p className="text-center text-xs text-off/65">
        {L(`搭乗 ${snap.crew.length}人・接続中 ${online}人`, `${snap.crew.length} aboard · ${online} online`)}
        {snap.bestScore != null && L(` ・ 最高スコア ${Math.round(snap.bestScore)}`, ` · best score ${Math.round(snap.bestScore)}`)}
      </p>
    </div>
  );
}
