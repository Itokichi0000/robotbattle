'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheerEmoji, MeResponse, PublicMatchSnapshot, TeamId, ZapResponse } from '@sats-wars/shared';
import { CHEER_EMOJIS, SATS_EXPLAINER, TEAM_META, otherTeam, zapsFor } from '@sats-wars/shared';
import { TeamBadge } from '@/components/TeamBits';
import { ApiError, api, newClientActionId } from '@/lib/api';
import { battleView, teamName } from '@/lib/battle';
import type { MatchConnection } from '@/lib/connection';
import { useTicker } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import type { PlaySession } from './session';
import { Topup } from './Topup';

interface Flash {
  id: number;
  text: string;
  tone: 'hit' | 'special' | 'ko' | 'info' | 'warn';
}

/** Client-side spacing between punches; the server enforces its own cooldown too. */
const TAP_GAP_MS = 260;

/** Screen 2: one huge button. Everything a newcomer needs is on this screen. */
export function Controller({
  snap,
  conn,
  session,
  me,
  onMe,
  onSession,
  refreshMe,
}: {
  snap: PublicMatchSnapshot;
  conn: MatchConnection;
  session: PlaySession;
  me: MeResponse | null;
  onMe: (m: MeResponse | ((prev: MeResponse | null) => MeResponse | null)) => void;
  onSession: (s: PlaySession) => void;
  refreshMe: () => Promise<void>;
}) {
  const { L, locale } = useI18n();
  useTicker(250);
  const [topupOpen, setTopupOpen] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pressed, setPressed] = useState(0);
  const [cheerCd, setCheerCd] = useState(false);
  const [teamMenu, setTeamMenu] = useState(false);
  const lastTap = useRef(0);
  const flashId = useRef(0);

  const c = snap.config;
  const my: TeamId = me?.teamId ?? session.teamId;
  const foe = otherTeam(my);
  const v = battleView(snap, conn.now().clockMs);
  const credit = me?.creditSats ?? 0;
  const punchesLeft = zapsFor(credit, c);
  const fighting = snap.status === 'LIVE' && snap.phase === 'ROUND';

  const show = useCallback((text: string, tone: Flash['tone']) => {
    flashId.current += 1;
    setFlash({ id: flashId.current, text, tone });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const sendZap = async (clientActionId: string, retry = true): Promise<void> => {
    try {
      const r = await api<ZapResponse>('/api/zap', { token: session.token, body: { clientActionId } });
      onMe((m) => (m ? { ...m, creditSats: r.creditSats, zapsThisSeason: m.zapsThisSeason + (r.result.ok && !r.duplicate ? 1 : 0) } : m));
      const res = r.result;
      if (!res.ok) {
        show(
          res.code === 'PAUSED'
            ? L('一時停止中（satsは使われていません）', 'Paused (no sats used)')
            : L('ラウンドの合間です（satsは使われていません）', 'Between rounds (no sats used)'),
          'info',
        );
      } else if (res.code === 'KO') {
        show(L('KO!! あなたのとどめ！', 'KO!! Your finishing blow!'), 'ko');
        void refreshMe();
      } else if (res.special) {
        show(L(`必殺技！ ${TEAM_META[my].specialJa} −${res.damage}`, `SPECIAL! ${TEAM_META[my].specialEn} −${res.damage}`), 'special');
      } else {
        show(L(`命中！ −${res.damage}${res.pinch ? '（1.5倍）' : ''}`, `HIT! −${res.damage}${res.pinch ? ' (×1.5)' : ''}`), 'hit');
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK' && retry) {
        // Same clientActionId: if the first request did land, the server
        // answers from storage and does not charge twice.
        await new Promise((r) => setTimeout(r, 600));
        return sendZap(clientActionId, false);
      }
      if (e instanceof ApiError && e.status === 402) {
        setTopupOpen(true);
        return;
      }
      if (e instanceof ApiError && e.status === 429) return; // tapping a bit too fast; harmless
      show(e instanceof ApiError ? e.message : String(e), 'warn');
    }
  };

  const punch = () => {
    if (credit < c.zapCostSats) {
      setTopupOpen(true);
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < TAP_GAP_MS) return;
    lastTap.current = now;
    setPressed((n) => n + 1);
    try {
      navigator.vibrate?.(12);
    } catch {
      // vibration unsupported
    }
    void sendZap(newClientActionId());
  };

  const cheer = async (emoji: CheerEmoji) => {
    if (cheerCd) return;
    setCheerCd(true);
    setTimeout(() => setCheerCd(false), c.cheerCooldownMs + 50);
    try {
      await api('/api/cheer', { token: session.token, body: { emoji } });
      show(L(`${emoji} 応援を送りました（無料）`, `${emoji} Cheer sent (free)`), 'info');
    } catch {
      // cheers are best effort
    }
  };

  const switchTeam = async (teamId: TeamId) => {
    setTeamMenu(false);
    try {
      await api('/api/me/team', { token: session.token, body: { teamId } });
      onSession({ ...session, teamId });
      onMe((m) => (m ? { ...m, teamId } : m));
    } catch (e) {
      show(e instanceof ApiError ? e.message : String(e), 'warn');
    }
  };

  // ---- button label by phase ------------------------------------------------
  let label: React.ReactNode;
  let sub: React.ReactNode;
  let disabled = false;
  if (snap.status === 'PAUSED') {
    label = L('一時停止中', 'Paused');
    sub = L('少し待ってね', 'Please wait');
    disabled = true;
  } else if (snap.status !== 'LIVE' || snap.phase === 'SEASON_END') {
    label = L('次のシーズンまで少し待ってね', 'Next season soon');
    sub = snap.result?.winnerTeamId
      ? L(`${teamName(snap.result.winnerTeamId, 'ja')}が全国制覇！`, `${teamName(snap.result.winnerTeamId, 'en')} conquered Japan!`)
      : '';
    disabled = true;
  } else if (snap.phase === 'OPENING' || snap.phase === 'ROUND_END') {
    const nextJa = v.nextRegionId ? (snap.phase === 'OPENING' ? v.regionJa : '') : '';
    label = L(`まもなく次の戦い ${v.secondsLeft ?? ''}`, `Next fight in ${v.secondsLeft ?? ''}`);
    sub = snap.phase === 'ROUND_END' && snap.round?.winnerTeamId
      ? L(`${teamName(snap.round.winnerTeamId, 'ja')}が${v.regionJa}をゲット！`, `${teamName(snap.round.winnerTeamId, 'en')} took ${v.regionEn}!`)
      : nextJa;
    disabled = true;
  } else if (credit < c.zapCostSats) {
    label = L('チャージしてパンチ！', 'Top up to punch!');
    sub = L(`1発 ${c.zapCostSats} sats`, `${c.zapCostSats} sats per punch`);
  } else {
    label = L('パンチ！', 'PUNCH!');
    sub = L(`1発 ${c.zapCostSats} sats ・ 残り${punchesLeft}発`, `${c.zapCostSats} sats ・ ${punchesLeft} left`);
  }
  const m = TEAM_META[my];
  const mf = TEAM_META[foe];
  const hpPct = (t: TeamId) => Math.max(0, Math.min(100, (v.hp[t] / v.hpMax) * 100));

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="controller">
      {/* Who am I */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TeamBadge teamId={my} locale={locale} className="text-lg" />
          <span className="truncate text-sm font-bold text-off/85">{me?.nickname ?? session.nickname}</span>
        </div>
        <button type="button" className="sw-focus rounded-full border border-line px-3 py-1 text-xs font-bold" onClick={() => setTeamMenu((x) => !x)}>
          {L('チーム変更', 'Switch team')}
        </button>
      </div>
      {teamMenu && (
        <div className="sw-panel flex items-center justify-between gap-2 p-2 text-sm">
          <span>{L(`${mf.nameJa}に変更しますか？（無料）`, `Switch to ${mf.nameEn}? (free)`)}</span>
          <button type="button" className="sw-btn px-3" style={{ background: mf.color, color: '#070D1A' }} onClick={() => void switchTeam(foe)}>
            {mf.symbol} {L('変更', 'Switch')}
          </button>
        </div>
      )}

      {/* Battle status */}
      <section className="sw-panel p-3" aria-live="polite" data-testid="battle-status">
        <div className="flex items-baseline justify-between">
          <div className="font-black">
            {L(`第${v.roundNumber}戦`, `Round ${v.roundNumber}`)}
            <span className="ml-1 text-xs text-off/60">/{v.roundsTotal}</span>
            <span className="ml-2">⚔ {L(v.regionJa, v.regionEn)}</span>
          </div>
          <div className="sw-display text-2xl font-black tabular-nums" data-testid="phase-seconds">
            {v.secondsLeft !== null ? `${v.secondsLeft}s` : '—'}
          </div>
        </div>
        {([my, foe] as const).map((t) => (
          <div key={t} className="mt-2">
            <div className="flex justify-between text-xs font-bold">
              <span style={{ color: TEAM_META[t].color }}>
                {TEAM_META[t].symbol} {L(TEAM_META[t].nameJa, TEAM_META[t].nameEn)}
                {t === my ? L('（味方）', ' (you)') : ''}
                {v.pinch[t] && <span className="ml-1 text-yellow-300">{L('ピンチ！×1.5', 'PINCH ×1.5')}</span>}
              </span>
              <span className="tabular-nums">
                HP {v.hp[t]}/{v.hpMax}
              </span>
            </div>
            <div className="mt-0.5 h-4 overflow-hidden rounded bg-black/50 ring-1 ring-white/15" role="meter" aria-valuenow={v.hp[t]} aria-valuemin={0} aria-valuemax={v.hpMax} aria-label={`${TEAM_META[t].nameJa} HP`}>
              <div className="h-full transition-[width] duration-200" style={{ width: `${hpPct(t)}%`, background: TEAM_META[t].color }} />
            </div>
          </div>
        ))}
        {fighting && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-black/35 p-2">
              <div className="text-xs text-off/70">{L(`チームで${mf.nameJa}KOまで`, `Team needs to KO ${mf.nameEn}`)}</div>
              <div className="font-black" data-testid="to-ko">
                <span className="text-sm">{L('あと', '')}</span>
                <span className="sw-display mx-0.5 text-3xl tabular-nums">{v.toKo[my]}</span>
                <span className="text-sm">{L('発', ' punches')}</span>
              </div>
            </div>
            <div className="rounded-lg bg-black/35 p-2">
              <div className="text-xs text-off/70">{L('チームの必殺技まで', 'Team special in')}</div>
              <div className="font-black text-yellow-300">
                <span className="text-sm">{L('あと', '')}</span>
                <span className="sw-display mx-0.5 text-3xl tabular-nums">{v.toSpecial[my]}</span>
                <span className="text-sm">{L('発', ' punches')}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* The button */}
      <div className="relative flex flex-col items-center py-2">
        <button
          type="button"
          onClick={punch}
          disabled={disabled}
          className="sw-focus relative flex aspect-square w-[78%] max-w-[340px] select-none flex-col items-center justify-center rounded-full font-black transition-transform active:scale-95 disabled:opacity-45"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${m.colorLight}, ${m.color} 45%, ${m.colorDark})`,
            color: '#070D1A',
            boxShadow: `0 10px 0 ${m.colorDark}, 0 0 40px ${m.color}66`,
            touchAction: 'manipulation',
          }}
          data-testid="punch-button"
        >
          <span key={pressed} className="text-7xl leading-none" aria-hidden>
            {m.symbol}
          </span>
          <span className="sw-display mt-1 px-4 text-center text-3xl leading-tight">{label}</span>
          <span className="mt-1 px-6 text-center text-sm font-bold opacity-85">{sub}</span>
        </button>
        {flash && (
          <div
            key={flash.id}
            role="status"
            className={`sw-banner-in pointer-events-none absolute top-0 rounded-full px-4 py-1 text-lg font-black shadow-lg ${
              flash.tone === 'ko'
                ? 'bg-white text-navy'
                : flash.tone === 'special'
                  ? 'bg-yellow-300 text-navy'
                  : flash.tone === 'warn'
                    ? 'bg-danger text-white'
                    : flash.tone === 'info'
                      ? 'bg-black/80 text-off'
                      : 'bg-navy-3 text-off ring-1 ring-white/30'
            }`}
            data-testid="punch-flash"
          >
            {flash.text}
          </div>
        )}
      </div>

      {/* Credit */}
      <div className="sw-panel flex items-center justify-between gap-2 p-3">
        <div>
          <div className="text-xs text-off/70">{L('残高', 'Balance')}</div>
          <div className="font-black tabular-nums" data-testid="credit">
            <span className="sw-display text-2xl">{credit}</span> <span className="text-sm">sats</span>
            <span className="ml-2 whitespace-nowrap text-sm text-off/80">= {L(`${punchesLeft}発`, `${punchesLeft} punches`)}</span>
          </div>
          {me && (
            <div className="text-xs text-off/65">
              {L(`今シーズン ${me.zapsThisSeason}発 ・ KO ${me.kos}回`, `This season ${me.zapsThisSeason} punches ・ ${me.kos} KOs`)}
            </div>
          )}
        </div>
        <button type="button" className="sw-btn bg-amber px-4 text-navy" onClick={() => setTopupOpen(true)} data-testid="open-topup">
          ⚡ {L('チャージ', 'Top up')}
        </button>
      </div>

      {/* Free cheer */}
      <div className="sw-panel p-3">
        <div className="mb-2 text-xs font-bold text-off/75">
          {L('無料で応援（会場の画面に出ます・satsは使いません）', 'Cheer for free (shown on the big screen)')}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {CHEER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              disabled={cheerCd}
              onClick={() => void cheer(e)}
              className="sw-focus rounded-lg bg-white/10 py-2 text-2xl disabled:opacity-40"
              aria-label={L(`${e} で応援`, `Cheer ${e}`)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-off/60">
        💡 {SATS_EXPLAINER[locale]}
        {L('。チャージした分は今日ずっと使えます（シーズンをまたいでも残ります）。', '. Your credit stays for the whole day, across seasons.')}
      </p>

      {topupOpen && (
        <Topup
          snap={snap}
          conn={conn}
          session={session}
          creditSats={credit}
          onClose={() => setTopupOpen(false)}
          onCredited={(creditSats) => onMe((mm) => (mm ? { ...mm, creditSats } : mm))}
        />
      )}
    </div>
  );
}
