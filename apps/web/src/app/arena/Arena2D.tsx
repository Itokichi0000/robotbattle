'use client';
import type { PublicRaidSnapshot } from '@sats-wars/shared';
import { ENEMY_LABELS } from '@sats-wars/shared';
import { JapanMapMini, type RaidView } from '@sats-wars/ui';

/**
 * Fallback when WebGL is unavailable or the GPU context is lost: the same
 * information as the 3D scene, as a big 2D map with the enemy line-up.
 */
export function Arena2D({
  snap,
  view,
  locale,
}: {
  snap: PublicRaidSnapshot;
  view: RaidView;
  locale: 'ja' | 'en';
}) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  return (
    <div
      className="absolute inset-0 flex items-center justify-center gap-[3vw] bg-[radial-gradient(ellipse_at_center,#14234a_0%,#070d1a_70%)] px-[22vw] pt-[14vh] pb-[12vh]"
      data-testid="arena-2d"
    >
      <div className="h-full max-h-[70vh] w-[44vw]">
        <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
      </div>
      <ul className="flex w-[14vw] flex-col gap-[0.8vh] text-[1.2vw]">
        {snap.enemies
          .filter((e) => e.hp > 0)
          .map((e) => (
            <li
              key={e.id}
              className={`rounded-xl px-[0.8vw] py-[0.6vh] ${e.ai === 'TELEGRAPH' ? 'bg-danger/70' : 'bg-navy-3/80'}`}
            >
              {ENEMY_LABELS[e.kind].icon} {L(ENEMY_LABELS[e.kind].ja, ENEMY_LABELS[e.kind].en)}
              <span className="block h-[0.8vh] overflow-hidden rounded bg-black/40">
                <span
                  className="block h-full bg-danger"
                  style={{ width: `${(e.hp / e.hpMax) * 100}%` }}
                />
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
