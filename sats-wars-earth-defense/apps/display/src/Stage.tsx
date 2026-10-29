import { useLayoutEffect, useState, type ReactNode } from 'react';

/**
 * 16:9 stage. The 3D canvas renders at the real pixel size; the HUD is laid out once at
 * 1920×1080 and scaled, so projectors of any size keep the same composition (spec §3.6).
 */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function Stage({ scene, hud }: { scene: ReactNode; hud: ReactNode }) {
  const [size, setSize] = useState({ w: STAGE_W, h: STAGE_H });
  useLayoutEffect(() => {
    const fit = () => {
      const w = Math.min(window.innerWidth, (window.innerHeight * 16) / 9);
      setSize({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="stage" style={{ width: size.w, height: size.h }}>
      <div className="stage-3d">{scene}</div>
      <div className="stage-hud" style={{ transform: `scale(${size.w / STAGE_W})` }}>
        {hud}
      </div>
    </div>
  );
}
