'use client';
import { STATUS_LABELS, formatClock } from '@sats-wars/shared';
import { JapanMap2D } from '@/components/JapanMap2D';
import { RobotGauge } from '@/components/TeamBits';
import { useMatchConnection, useSnapshot, useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function LandingLive() {
  const { L, locale } = useI18n();
  const conn = useMatchConnection('spectator');
  const snap = useSnapshot(conn);
  useTicker(500);
  if (!snap || !conn)
    return (
      <div className="sw-panel p-6 text-center text-off/70">
        {L('試合情報を読み込み中…', 'Loading match…')}
      </div>
    );
  const { gameMs } = conn.now();
  const cfg = snap.config;
  return (
    <div className="sw-panel p-4" data-testid="landing-live">
      <div className="flex items-center justify-between">
        <span className="font-black">{STATUS_LABELS[snap.status][locale]}</span>
        <span className="tabular-nums">
          {snap.status === 'LIVE'
            ? `${L('残り', 'Left')} ${formatClock(cfg.actionCloseMs - gameMs)}`
            : snap.status === 'LOBBY'
              ? `${L('開始まで', 'Starts in')} ${formatClock(-gameMs)}`
              : ''}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <RobotGauge
          team={snap.teams.RAIJIN}
          hp={snap.teams.RAIJIN.hp}
          hpMax={cfg.hpMax}
          energyMax={cfg.energyMax}
          specialThreshold={cfg.specialThreshold}
          locale={locale}
          size="sm"
        />
        <RobotGauge
          team={snap.teams.FUJIN}
          hp={snap.teams.FUJIN.hp}
          hpMax={cfg.hpMax}
          energyMax={cfg.energyMax}
          specialThreshold={cfg.specialThreshold}
          locale={locale}
          size="sm"
          align="right"
        />
      </div>
      <JapanMap2D
        regions={snap.regions}
        locale={locale}
        gameMs={gameMs}
        className="mx-auto mt-2 h-72 w-full"
      />
    </div>
  );
}
