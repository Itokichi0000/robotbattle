'use client';
import { useEffect, useState } from 'react';
import type { PublicMatchSnapshot, TeamId } from '@sats-wars/shared';
import type { BoardView } from '@/lib/battle';
import { TEAM_META } from '@sats-wars/shared';
import type { ArenaDirector } from '@sats-wars/three-game';
import { JapanMap2D } from '@/components/JapanMap2D';
import { Emblem } from '@/components/Logo';
import { useI18n } from '@/lib/i18n';

/**
 * Fallback renderer for venues without WebGL (or after a context loss).
 * Same information as the 3D view; the director still runs for poses/banners.
 */
export function Arena2D({ snap, view, director }: { snap: PublicMatchSnapshot; view: BoardView; director: ArenaDirector }) {
  const { locale } = useI18n();
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      director.update(dt);
      acc += dt;
      if (acc > 0.1) {
        acc = 0;
        force((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [director]);

  const robot = (t: TeamId) => {
    const cue = director.robots[t];
    const hit = cue.clip === 'HitReact';
    const attack =
      cue.clip === 'AttackHeavy' || cue.clip === 'AttackLight' || cue.clip === 'Special';
    const down = cue.clip === 'Defeat';
    // Both gods face the map in the middle (they fight together).
    const dx = attack ? (t === 'RAIJIN' ? 60 : -60) : hit ? (t === 'RAIJIN' ? -25 : 25) : 0;
    return (
      <div
        className="flex flex-col items-center transition-transform duration-300"
        style={{
          transform: `translateX(${dx}px) rotate(${down ? (t === 'RAIJIN' ? -20 : 20) : 0}deg)`,
          opacity: down ? 0.5 : 1,
        }}
        data-testid={`robot2d-${t}`}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: t === 'RAIJIN' ? 260 : 220,
            height: t === 'RAIJIN' ? 260 : 220,
            background: `radial-gradient(circle, ${TEAM_META[t].color}66, transparent 70%)`,
            boxShadow: attack ? `0 0 80px ${TEAM_META[t].color}` : undefined,
          }}
        >
          <span style={{ fontSize: t === 'RAIJIN' ? 150 : 130 }} aria-hidden>
            {TEAM_META[t].symbol}
          </span>
        </div>
        <div className="sw-display text-4xl font-black" style={{ color: TEAM_META[t].color }}>
          {locale === 'ja' ? TEAM_META[t].nameJa : TEAM_META[t].nameEn}
        </div>
      </div>
    );
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center gap-8 bg-[radial-gradient(ellipse_at_center,#13254a_0%,#070D1A_70%)] px-[4vw] pt-[10vh]"
      data-testid="arena-2d"
    >
      {robot('RAIJIN')}
      <div className="relative h-[62vh] w-[44vw]">
        <JapanMap2D
          regions={snap.regions}
          enemies={snap.enemies}
          cityHpMax={snap.config.cityHpMax}
          danger={view.danger}
          locale={locale}
          className="h-full w-full"
          labelScale={1.3}
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-10">
          <Emblem size={300} />
        </div>
      </div>
      {robot('FUJIN')}
    </div>
  );
}
