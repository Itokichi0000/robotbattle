'use client';
import { PHASE_LABELS, STATUS_LABELS } from '@sats-wars/shared';
import { JapanMap2D } from '@/components/JapanMap2D';
import { RobotGauge } from '@/components/TeamBits';
import { battleView } from '@/lib/battle';
import { useMatchConnection, useSnapshot, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function LandingLive() {
  const { L, locale } = useI18n();
  const conn = useMatchConnection('spectator');
  const snap = useSnapshot(conn);
  useTicker(500);
  if (!snap || !conn)
    return <div className="sw-panel p-6 text-center text-off/70">{L('試合情報を読み込み中…', 'Loading match…')}</div>;
  const v = battleView(snap, conn.now().clockMs);
  const fighting = snap.status === 'LIVE' && snap.phase === 'ROUND';
  return (
    <div className="sw-panel p-4" data-testid="landing-live">
      <div className="flex items-center justify-between">
        <span className="font-black">
          {snap.status === 'LIVE' ? PHASE_LABELS[snap.phase][locale] : STATUS_LABELS[snap.status][locale]}
          {v.regionId && snap.status === 'LIVE' && (
            <span className="ml-2 text-off/80">
              {L(`第${v.roundNumber}戦 ⚔ ${v.regionJa}`, `Round ${v.roundNumber} ⚔ ${v.regionEn}`)}
            </span>
          )}
        </span>
        <span className="tabular-nums">{v.secondsLeft !== null ? `${v.secondsLeft}s` : ''}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {(['RAIJIN', 'FUJIN'] as const).map((t) => (
          <RobotGauge
            key={t}
            teamId={t}
            hp={v.hp[t]}
            hpMax={v.hpMax}
            toKo={v.toKo[t]}
            toSpecial={v.toSpecial[t]}
            pinch={v.pinch[t]}
            supporters={snap.supporters[t]}
            regionsWon={v.regionsWon[t]}
            fighting={fighting}
            locale={locale}
            align={t === 'FUJIN' ? 'right' : 'left'}
          />
        ))}
      </div>
      <JapanMap2D
        regions={snap.regions}
        locale={locale}
        focusRegionId={fighting ? v.regionId : null}
        className="mx-auto mt-2 h-72 w-full"
      />
    </div>
  );
}
