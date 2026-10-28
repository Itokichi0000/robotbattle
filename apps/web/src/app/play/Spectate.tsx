'use client';
import type { PublicMatchSnapshot } from '@sats-wars/shared';
import { formatClock } from '@sats-wars/shared';
import { EventFeed } from '@/components/EventFeed';
import { JapanMap2D } from '@/components/JapanMap2D';
import { RobotGauge } from '@/components/TeamBits';
import type { MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function Spectate({ snap, conn, onBack }: { snap: PublicMatchSnapshot; conn: MatchConnection; onBack: () => void }) {
  const { L, locale } = useI18n();
  useTicker(500);
  const { gameMs } = conn.now();
  const cfg = snap.config;
  return (
    <div className="flex flex-col gap-3" data-testid="spectate-view">
      <section className="sw-panel grid grid-cols-2 gap-3 p-3">
        <RobotGauge team={snap.teams.RAIJIN} hp={snap.teams.RAIJIN.hp} hpMax={cfg.hpMax} energyMax={cfg.energyMax} specialThreshold={cfg.specialThreshold} locale={locale} size="sm" />
        <RobotGauge team={snap.teams.FUJIN} hp={snap.teams.FUJIN.hp} hpMax={cfg.hpMax} energyMax={cfg.energyMax} specialThreshold={cfg.specialThreshold} locale={locale} size="sm" align="right" />
      </section>
      {snap.nextClash && snap.status === 'LIVE' && (
        <p className="text-center font-bold">
          {L('次の激突まで', 'Next clash in')} {formatClock(snap.nextClash.atGameMs - gameMs)}
        </p>
      )}
      <div className="sw-panel p-2">
        <JapanMap2D regions={snap.regions} locale={locale} gameMs={gameMs} className="mx-auto h-[340px] w-full" />
      </div>
      <EventFeed events={snap.recentEvents} limit={6} />
      <button className="sw-btn bg-white/10 py-3" onClick={onBack}>
        {L('参加画面へ戻る', 'Back to join')}
      </button>
    </div>
  );
}
