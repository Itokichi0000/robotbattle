'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRaidSnapshot, ReplayEvent, ReplayResponse } from '@sats-wars/shared';
import { ENEMY_LABELS, ROLE_LABELS, SPECIAL_LABELS } from '@sats-wars/shared';
import {
  JapanMapMini,
  RaidHeader,
  cityName,
  effectSentence,
  fmtClock,
  raidView,
} from '@sats-wars/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Lx = (ja: string, en: string) => string;

/** One line for the log, or null for events the replay does not narrate. */
export function describeEvent(e: ReplayEvent, L: Lx): { text: string; big: boolean } | null {
  switch (e.type) {
    case 'PHASE_CHANGED':
      return null;
    case 'ENEMY_SPAWNED':
      return e.data.enemy.kind === 'BOSS'
        ? { text: `🌑 ${L('NULL CORE 出現', 'NULL CORE appears')}`, big: true }
        : null;
    case 'ENEMY_DEFEATED':
      return {
        text: `💥 ${L(ENEMY_LABELS[e.data.kind].ja, ENEMY_LABELS[e.data.kind].en)} ${L('撃破', 'destroyed')}${e.data.callsign ? ` — ${e.data.callsign}` : ''}`,
        big: e.data.kind === 'BOSS',
      };
    case 'CITY_DESTROYED':
      return { text: `🔥 ${cityName(e.data.cityId, L)} ${L('陥落', 'fell')}`, big: true };
    case 'CITY_REBUILT':
      return {
        text: `🏗 ${cityName(e.data.cityId, L)} ${L('再建', 'rebuilt')} — ${e.data.callsign}`,
        big: true,
      };
    case 'SPECIAL_WINDOW_OPENED':
      return { text: `⚡🌀 ${L('神雷風陣の窓が開いた', 'Special window opened')}`, big: false };
    case 'SPECIAL_RESOLVED':
      return {
        text: `⚡🌀 ${L(SPECIAL_LABELS[e.data.outcome].ja, SPECIAL_LABELS[e.data.outcome].en)}`,
        big: true,
      };
    case 'TASK_RESOLVED':
      return e.data.success > 0
        ? {
            text: `${e.data.assist ? L('補佐AI', 'AI assist') : e.data.callsign} ${ROLE_LABELS[e.data.role].icon} ${effectSentence(e.data.effect, L)}`,
            big: false,
          }
        : null;
    case 'ATTACK_RESOLVED': {
      const hit = e.data.hits.filter((h) => h.damage - h.absorbed > 0);
      if (!hit.length)
        return { text: `🛡 ${L('攻撃をシールドで防いだ', 'Shields held the attack')}`, big: false };
      return {
        text: `⚠ ${hit.map((h) => `${cityName(h.cityId, L)} −${Math.round(h.damage - h.absorbed)}`).join('・')}`,
        big: false,
      };
    }
    case 'RAID_ENDED':
      return {
        text:
          e.data.result.outcome === 'SUCCEEDED'
            ? L('🏆 地球防衛成功', '🏆 Earth defended')
            : L('防衛失敗', 'Defence failed'),
        big: true,
      };
    default:
      return null;
  }
}

/**
 * Replay of a finished raid from the server's event log: a timeline you can
 * scrub or play at ×8, the map and robots at that moment, and the log of what
 * happened. Names arrive moderated by the server.
 */
export function ReplayPlayer({ snap }: { snap: PublicRaidSnapshot }) {
  const { L, locale } = useI18n();
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    api<ReplayResponse>(`/api/raids/${encodeURIComponent(snap.raidId)}/replay`)
      .then(setReplay)
      .catch(() => setFailed(true));
  }, [snap.raidId]);

  useEffect(() => {
    if (!playing || !replay) return;
    let raf = 0;
    const step = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      setT((x) => {
        const next = Math.min(replay.endGameMs, x + dt * 8);
        if (next >= replay.endGameMs) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, replay]);

  const lines = useMemo(
    () =>
      (replay?.events ?? [])
        .map((e) => ({ e, d: describeEvent(e, L) }))
        .filter((x): x is { e: ReplayEvent; d: { text: string; big: boolean } } => !!x.d),
    [replay, L],
  );

  if (failed) return null;
  if (!replay)
    return <p className="text-sm text-muted">{L('リプレイを読み込み中…', 'Loading replay…')}</p>;
  if (!replay.frames.length) return null;

  // The board at time t: the last sampled frame at or before it.
  let lo = 0;
  let hi = replay.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (replay.frames[mid]!.gameMs <= t) lo = mid;
    else hi = mid - 1;
  }
  const frame = replay.frames[lo]!;
  const ended = t >= replay.endGameMs;
  const raid = {
    ...snap,
    ...frame.board,
    crew: frame.board.crew ?? snap.crew,
    gameMs: t,
    status: ended ? snap.status : ('LIVE' as const),
    result: ended ? snap.result : null,
  };
  const view = raidView(raid, t);
  const recent = lines
    .filter((x) => x.e.gameMs <= t)
    .slice(-6)
    .reverse();
  const highlights = lines.filter((x) => x.d.big);

  return (
    <section className="sw-panel flex flex-col gap-3 p-4" data-testid="replay">
      <h2 className="font-black">{L('リプレイ', 'Replay')}</h2>
      <RaidHeader raid={raid} view={view} locale={locale} compact />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="sw-btn sw-focus bg-teal px-4 text-navy"
          onClick={() => {
            if (ended) setT(0);
            setPlaying((p) => !p);
          }}
          data-testid="replay-play"
        >
          {playing ? '⏸' : '▶'} ×8
        </button>
        <input
          type="range"
          min={0}
          max={replay.endGameMs}
          step={1000}
          value={Math.round(t)}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
          className="flex-1"
          aria-label={L('再生位置', 'Position')}
          data-testid="replay-seek"
        />
        <span className="w-12 text-right font-mono text-sm tabular-nums">{fmtClock(t)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="mx-auto w-full max-w-sm">
          <JapanMapMini view={view} locale={locale} maxHp={snap.config.cityMaxHp} />
        </div>
        <ol className="flex flex-col gap-1 text-sm" aria-live="off" data-testid="replay-log">
          {recent.length === 0 && (
            <li className="text-muted">{L('▶ を押すと再生', 'Press ▶ to play')}</li>
          )}
          {recent.map(({ e, d }) => (
            <li key={e.seq} className={d.big ? 'font-bold' : 'text-off/80'}>
              <span className="tabular-nums text-muted">{fmtClock(e.gameMs)}</span> {d.text}
            </li>
          ))}
        </ol>
      </div>
      {highlights.length > 0 && (
        <div>
          <h3 className="text-sm font-black">
            {L('ハイライト（押すとその場面へ）', 'Highlights (tap to jump)')}
          </h3>
          <ul className="mt-1 flex flex-wrap gap-1 text-xs">
            {highlights.map(({ e, d }) => (
              <li key={e.seq}>
                <button
                  type="button"
                  className="sw-focus rounded-full border border-line px-2 py-1 hover:bg-white/10"
                  onClick={() => {
                    setPlaying(false);
                    setT(Math.max(0, e.gameMs - 3000));
                  }}
                >
                  {fmtClock(e.gameMs)} {d.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
