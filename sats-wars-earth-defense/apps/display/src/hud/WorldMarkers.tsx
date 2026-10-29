import { CITIES, CITY_IDS, DIRECTION_LABEL, SEATS } from '@swed/shared';
import type { CityId, PublicMatchState } from '@swed/shared';
import { useEffect, useRef } from 'react';
import { screen } from '../scene/anchors';

/**
 * Labels pinned to world positions (spec §4.4, §9.1): lock brackets on targets, city names
 * on the hologram, red countdowns on threatened cities. Positions update every animation
 * frame from the 3D projector; text updates with the 10 Hz HUD tick.
 */
export function WorldMarkers({ s, mt }: { s: PublicMatchState; mt: number }) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      for (const [anchor, el] of refs.current) {
        const p = screen.get(anchor);
        if (!p || !p.visible) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = 'visible';
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const bind = (anchor: string) => (el: HTMLDivElement | null) => {
    if (el) refs.current.set(anchor, el);
    else refs.current.delete(anchor);
  };

  const threatened = new Map<CityId, number>();
  const threatDir = new Map<CityId, string>();
  for (const th of s.threats) {
    if (th.target.type !== 'CITY') continue;
    const prev = threatened.get(th.target.cityId);
    if (prev === undefined || th.impactAt < prev) {
      threatened.set(th.target.cityId, th.impactAt);
      threatDir.set(th.target.cityId, DIRECTION_LABEL[th.dir].en);
    }
  }
  const locks = (['GUNNER_L', 'GUNNER_R'] as const)
    .map((seat) => ({ seat, g: s.gunners[seat] }))
    .filter((x) => x.g.targetId && s.enemies.some((e) => e.id === x.g.targetId));

  return (
    <>
      {CITY_IDS.map((id) => {
        const c = s.cities[id];
        const at = threatened.get(id);
        const cls = c.lost ? 'lost' : at !== undefined ? 'threat' : '';
        return (
          <div key={id} ref={bind(`city:${id}`)} className={`marker city ${cls}`}>
            <span className="nm">
              {CITIES[id].nameJa}
              {at !== undefined && !c.lost
                ? ` ${CITIES[id].nameEn} ${Math.max(0, (at - mt) / 1000).toFixed(1)}s ${threatDir.get(id)}`
                : ''}
            </span>
          </div>
        );
      })}
      {locks.map(({ seat, g }) => {
        const e = s.enemies.find((x) => x.id === g.targetId)!;
        const weak = e.weakUntil > mt;
        const ready = mt >= g.readyAt;
        return (
          <div
            key={seat}
            ref={bind(`enemy:${e.id}`)}
            className={`marker lock${weak ? ' weak' : ''}`}
          >
            <svg className="box" viewBox="0 0 92 92" aria-hidden>
              <path
                d="M2 24V2h22M68 2h22v22M90 68v22H68M24 90H2V68"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
              />
              {ready ? <circle cx={46} cy={46} r={6} fill="currentColor" /> : null}
            </svg>
            <div className="tag">
              {SEATS[seat].labelEn} LOCK{weak ? '  WEAK POINT' : ''}
              <small>
                {e.kind} {Math.round((e.hp / e.maxHp) * 100)}% {ready ? 'READY' : 'CHARGING'}
              </small>
            </div>
          </div>
        );
      })}
    </>
  );
}
