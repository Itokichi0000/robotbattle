import { DIRECTION_LABEL, SQUADS, SQUAD_IDS, ZONE_IDS, ZONES } from '@swed/shared';
import type { SquadId, PublicMatchState } from '@swed/shared';
import { useEffect, useRef } from 'react';
import { screen } from '../scene/anchors';

/**
 * Labels pinned to world positions (spec §4.4, §9.1): planet and squad names on the route
 * hologram, red countdowns on threatened squads. Positions update every animation
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

  const threatened = new Map<SquadId, number>();
  const threatDir = new Map<SquadId, string>();
  for (const th of s.threats) {
    if (th.target.type !== 'SQUAD') continue;
    const prev = threatened.get(th.target.squadId);
    if (prev === undefined || th.impactAt < prev) {
      threatened.set(th.target.squadId, th.impactAt);
      threatDir.set(th.target.squadId, DIRECTION_LABEL[th.dir].en);
    }
  }
  return (
    <>
      {ZONE_IDS.map((z) => (
        <div key={z} ref={bind(`planet:${z}`)} className={`marker planet ${z.toLowerCase()}`}>
          <span className="nm">{ZONES[z].planetJa}</span>
        </div>
      ))}
      {SQUAD_IDS.map((id) => {
        const c = s.squads[id];
        const at = threatened.get(id);
        const cls = c.lost ? 'lost' : at !== undefined ? 'threat' : '';
        // Six names on a small hologram overlap; a squad is named only while it is the target
        // (the threat call says the same) or once it is lost (struck through).
        if (!cls) return <div key={id} ref={bind(`squad:${id}`)} className="marker squad" />;
        return (
          <div key={id} ref={bind(`squad:${id}`)} className={`marker squad ${cls}`}>
            <span className="nm">
              {SQUADS[id].nameJa}
              {at !== undefined && !c.lost
                ? ` ${SQUADS[id].nameEn} ${Math.max(0, (at - mt) / 1000).toFixed(1)}s ${threatDir.get(id)}`
                : ''}
            </span>
          </div>
        );
      })}
    </>
  );
}
