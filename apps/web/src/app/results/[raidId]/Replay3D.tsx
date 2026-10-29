'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardPatch, GameEvent, PublicRaidSnapshot, ReplayResponse } from '@sats-wars/shared';
import { ArenaDirector, type Banner, cueFromEvent } from '@sats-wars/three-game';
import { fmtClock, raidView } from '@sats-wars/ui';
import { downloadBlob, recordCanvas } from '@/lib/recorder';
import { useI18n } from '@/lib/i18n';

const ArenaScene = dynamic(() => import('@sats-wars/three-game').then((m) => m.ArenaScene), {
  ssr: false,
  loading: () => null,
});

export interface RecordRequest {
  id: number;
  seconds: number;
  label: string;
}

/**
 * The finished raid replayed in the venue's 3D scene: the server's event log
 * drives the same director as the live screen (cues as the playhead passes
 * them), the board comes from the sampled frames. Seeking back resets the
 * director (cinematics are not rewound, only the state is).
 */
export function Replay3D({
  replay,
  snap,
  board,
  t,
  record,
  onRecorded,
}: {
  replay: ReplayResponse;
  snap: PublicRaidSnapshot;
  board: BoardPatch;
  t: number;
  record: RecordRequest | null;
  onRecorded: (ok: boolean) => void;
}) {
  const { L, locale } = useI18n();
  const director = useMemo(() => new ArenaDirector(), []);
  const lastT = useRef(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerRef = useRef<Banner | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ t, boss: 0 as number | null });

  useEffect(() => director.onBanner((b) => ((bannerRef.current = b), setBanner(b))), [director]);

  // Cues for the events the playhead just passed (reset on a backwards seek).
  useEffect(() => {
    if (t < lastT.current - 50) {
      director.reset();
      lastT.current = t;
      return;
    }
    for (const e of replay.events) {
      if (e.gameMs <= lastT.current || e.gameMs > t) continue;
      cueFromEvent(director, { ...e, patch: board } as GameEvent);
    }
    lastT.current = t;
  }, [t, replay, board, director]);

  const raid = {
    ...snap,
    ...board,
    crew: board.crew ?? snap.crew,
    gameMs: t,
    status: 'LIVE' as const,
    result: null,
  };
  const view = raidView(raid, t);
  live.current = { t, boss: view.bossHpRatio };

  // Highlight recording: 3D canvas + clock, boss bar and banner captions.
  const busy = useRef(false);
  useEffect(() => {
    if (!record || busy.current) return;
    const canvas = box.current?.querySelector('canvas');
    if (!canvas) {
      onRecorded(false);
      return;
    }
    busy.current = true;
    void recordCanvas({
      source: canvas,
      seconds: record.seconds,
      overlay: (ctx, w, h) => {
        ctx.fillStyle = 'rgba(7,13,26,0.65)';
        ctx.fillRect(0, 0, w, 56);
        ctx.fillStyle = '#EFF5FF';
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.fillText('SATS WARS: EARTH DEFENSE', 20, 37);
        ctx.textAlign = 'right';
        ctx.fillText(
          `⏱ ${fmtClock(Math.max(0, snap.config.matchSeconds * 1000 - live.current.t))}`,
          w - 20,
          37,
        );
        ctx.textAlign = 'left';
        const boss = live.current.boss;
        if (boss !== null) {
          ctx.fillStyle = '#41506E';
          ctx.fillRect(w / 2 - 200, 20, 400, 16);
          ctx.fillStyle = '#FF3B5C';
          ctx.fillRect(w / 2 - 200, 20, 400 * boss, 16);
        }
        const b = bannerRef.current;
        if (b) {
          ctx.fillStyle = 'rgba(7,13,26,0.7)';
          ctx.fillRect(0, h - 120, w, 120);
          ctx.fillStyle = b.tone === 'enemy' ? '#FF3B5C' : '#F7931A';
          ctx.font = '900 44px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(locale === 'ja' ? b.textJa : b.textEn, w / 2, h - 62);
          const sub = locale === 'ja' ? b.subJa : b.subEn;
          if (sub) {
            ctx.fillStyle = '#EFF5FF';
            ctx.font = '600 24px system-ui, sans-serif';
            ctx.fillText(sub, w / 2, h - 24);
          }
          ctx.textAlign = 'left';
        }
        ctx.fillStyle = 'rgba(239,245,255,0.8)';
        ctx.font = '600 18px system-ui, sans-serif';
        ctx.fillText(record.label, 20, 80);
      },
    })
      .then(({ blob, mimeType }) => {
        downloadBlob(
          blob,
          `sats-wars-${replay.raidId}-highlight.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`,
        );
        onRecorded(true);
      })
      .catch(() => onRecorded(false))
      .finally(() => {
        busy.current = false;
      });
  }, [record, onRecorded, replay.raidId, snap.config.matchSeconds, locale]);

  const threats = Object.fromEntries(
    Object.entries(view.threats).map(([k, x]) => [k, { seconds: x!.seconds, lethal: x!.lethal }]),
  );

  return (
    <div
      ref={box}
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-navy"
      data-testid="replay-3d"
    >
      <ArenaScene
        director={director}
        cities={board.cities}
        enemies={board.enemies}
        telegraphs={board.telegraphs}
        threats={threats}
        cityMaxHp={snap.config.cityMaxHp}
        glow={{
          RAIJIN: 0.15 + 0.85 * ((board.robots[0]?.energy ?? 0) / 100),
          FUJIN: 0.15 + 0.85 * ((board.robots[1]?.energy ?? 0) / 100),
        }}
        reserve={board.reserveEnergy / 100}
        quality="medium"
        reducedMotion={false}
        locale={locale}
        bossBarrier={view.bossBarrier}
        crew={board.crew ?? snap.crew}
        preserveDrawingBuffer
      />
      {banner && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center">
          <p className="sw-display text-xl text-amber drop-shadow">
            {L(banner.textJa, banner.textEn)}
          </p>
          {(banner.subJa || banner.subEn) && (
            <p className="text-sm text-off">{L(banner.subJa ?? '', banner.subEn ?? '')}</p>
          )}
        </div>
      )}
    </div>
  );
}
