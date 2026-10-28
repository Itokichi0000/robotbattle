'use client';
import { STATUS_LABELS } from '@sats-wars/shared';
import { FallMeter, TurnGauge } from '@/components/DefenceBits';
import { JapanMap2D } from '@/components/JapanMap2D';
import { boardView } from '@/lib/battle';
import { useMatchConnection, useSnapshot } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function LandingLive() {
  const { L, locale } = useI18n();
  const conn = useMatchConnection('spectator');
  const snap = useSnapshot(conn);
  if (!snap || !conn)
    return <div className="sw-panel p-6 text-center text-off/70">{L('試合情報を読み込み中…', 'Loading match…')}</div>;
  const v = boardView(snap);
  const live = snap.status === 'LIVE';
  return (
    <div className="sw-panel p-4" data-testid="landing-live">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-black">
          {STATUS_LABELS[snap.status][locale]}
          <span className="ml-2 text-off/80">{L(`ウェーブ ${snap.wave}`, `Wave ${snap.wave}`)}</span>
        </span>
        <span className="text-sm">
          <FallMeter fallen={v.fallenCount} limit={snap.config.fallLimit} locale={locale} />
        </span>
      </div>
      {live && (
        <div className="mt-1 text-sm">
          <TurnGauge left={v.turnLeft} total={snap.config.actionsPerTurn} locale={locale} />
        </div>
      )}
      <JapanMap2D
        regions={snap.regions}
        enemies={snap.enemies}
        cityHpMax={snap.config.cityHpMax}
        danger={v.danger}
        locale={locale}
        className="mx-auto mt-2 h-72 w-full"
      />
      <p className="mt-1 text-center text-xs text-off/65">
        {L(`隊員 ${snap.playersOnline}人 参戦中`, `${snap.playersOnline} defenders online`)}
        {snap.bestWave > 0 && L(` ・ 最高記録 ウェーブ${snap.bestWave}`, ` ・ best: wave ${snap.bestWave}`)}
      </p>
    </div>
  );
}
