import { CITIES, CITY_IDS, DIRECTION_LABEL } from '@swed/shared';
import type { CityId, PublicMatchState } from '@swed/shared';
import { useEffect, useRef } from 'react';
import { screen } from '../scene/anchors';

/**
 * Labels pinned to world positions (spec §4.4, §9.1): city names
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
    </>
  );
}
