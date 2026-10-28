'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActionResponse,
  ActionResult,
  CheerEmoji,
  MeResponse,
  PlayerAction,
  PublicMatchSnapshot,
  RegionId,
} from '@sats-wars/shared';
import { ACTION_ERROR_LABELS, ACTION_LABELS, CHEER_EMOJIS, ONE_LINE_RULES, SATS_EXPLAINER, actionsFor } from '@sats-wars/shared';
import { ComboGauge, FallMeter, TurnGauge } from '@/components/DefenceBits';
import { JapanMap2D } from '@/components/JapanMap2D';
import { ApiError, api, newClientActionId } from '@/lib/api';
import { boardView, describePlan, enemyName, regionName } from '@/lib/battle';
import type { MatchConnection } from '@/lib/connection';
import { useI18n } from '@/lib/i18n';
import type { PlaySession } from './session';
import { Topup } from './Topup';

interface Flash {
  id: number;
  text: string;
  tone: 'hit' | 'big' | 'info' | 'warn' | 'alien';
}

/** Client-side spacing between actions; the server enforces its own cooldown too. */
const TAP_GAP_MS = 350;

/**
 * The whole phone game on one screen:
 *  - a big おすすめ button (one tap does something useful, chosen by the engine)
 *  - the map + four moves for people who want to choose themselves.
 * Every move costs the same; refused moves are free.
 */
export function Controller({
  snap,
  conn,
  session,
  me,
  onMe,
  onSession,
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
  const [topupOpen, setTopupOpen] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [cheerCd, setCheerCd] = useState(false);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const lastTap = useRef(0);
  const flashId = useRef(0);

  const c = snap.config;
  const v = boardView(snap);
  const credit = me?.creditSats ?? 0;
  const movesLeft = actionsFor(credit, c);
  const live = snap.status === 'LIVE';

  const show = useCallback((text: string, tone: Flash['tone']) => {
    flashId.current += 1;
    setFlash({ id: flashId.current, text, tone });
  }, []);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  // Forget a target alien once it is gone.
  useEffect(() => {
    if (target !== null && !snap.enemies.some((e) => e.id === target)) setTarget(null);
  }, [snap.enemies, target]);

  const describe = (res: ActionResult): Flash => {
    if (!res.ok) {
      const lab = ACTION_ERROR_LABELS[res.code as keyof typeof ACTION_ERROR_LABELS];
      return { id: 0, text: lab ? L(lab.ja, lab.en) : res.code, tone: 'info' };
    }
    const where = res.regionId ? regionName(res.regionId, locale) : '';
    if (res.liberated) return { id: 0, text: L(`${where} 奪還！ あなたのおかげ！`, `${where} liberated thanks to you!`), tone: 'big' };
    if (res.action === 'COMBO') return { id: 0, text: L(`💥 合体技！ ${res.kills}体撃破`, `💥 COMBO! ${res.kills} down`), tone: 'big' };
    if (res.action === 'SHIELD') return { id: 0, text: L(`🛡 ${where}に結界！`, `🛡 Barrier on ${where}!`), tone: 'hit' };
    const icon = res.action ? ACTION_LABELS[res.action].icon : '';
    if (res.kills > 0) return { id: 0, text: L(`${icon} 撃破！ ×${res.kills}`, `${icon} Destroyed ×${res.kills}`), tone: 'big' };
    return { id: 0, text: L(`${icon} 命中！ −${res.damage}`, `${icon} Hit! −${res.damage}`), tone: 'hit' };
  };

  const send = async (
    body: { clientActionId: string; action: PlayerAction; regionId?: RegionId; enemyId?: number },
    retry = true,
  ): Promise<void> => {
    try {
      const r = await api<ActionResponse>('/api/action', { token: session.token, body });
      const counted = r.result.ok && !r.duplicate ? 1 : 0;
      onMe((m) =>
        m
          ? { ...m, creditSats: r.creditSats, actionsThisCampaign: m.actionsThisCampaign + counted, actionsTotal: m.actionsTotal + counted, kills: m.kills + (r.duplicate ? 0 : r.result.kills) }
          : m,
      );
      const f = describe(r.result);
      show(f.text, f.tone);
      if (r.result.ok && r.result.triggeredAlienTurn) {
        setTimeout(() => show(L('👾 あなたの一手で敵ターン！', '👾 Your move triggered the alien turn!'), 'alien'), 1300);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK' && retry) {
        // Same clientActionId: if the first request did land, the server
        // answers from storage and does not charge twice.
        await new Promise((r) => setTimeout(r, 600));
        return send(body, false);
      }
      if (e instanceof ApiError && e.status === 402) {
        setTopupOpen(true);
        return;
      }
      if (e instanceof ApiError && e.status === 429) return; // tapping a bit too fast; harmless
      show(e instanceof ApiError ? e.message : String(e), 'warn');
    }
  };

  const act = (action: PlayerAction, regionId?: RegionId, enemyId?: number) => {
    if (credit < c.actionCostSats) {
      setTopupOpen(true);
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < TAP_GAP_MS) return;
    lastTap.current = now;
    try {
      navigator.vibrate?.(12);
    } catch {
      // vibration unsupported
    }
    void send({ clientActionId: newClientActionId(), action, regionId, enemyId });
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

  const saveName = async () => {
    if (nameEdit === null) return;
    try {
      const r = await api<{ nickname: string }>('/api/me/nickname', { token: session.token, body: { nickname: nameEdit } });
      onSession({ ...session, nickname: r.nickname });
      onMe((m) => (m ? { ...m, nickname: r.nickname } : m));
      setNameEdit(null);
    } catch (e) {
      show(e instanceof ApiError ? e.message : String(e), 'warn');
    }
  };

  // ---- main button ---------------------------------------------------------------
  let label: React.ReactNode;
  let sub: React.ReactNode;
  let disabled = false;
  if (snap.status === 'PAUSED') {
    label = L('一時停止中', 'Paused');
    sub = L('少し待ってね', 'Please wait');
    disabled = true;
  } else if (!live) {
    label = L('次の防衛戦まで少し待ってね', 'Next defence starts soon');
    sub = snap.result
      ? L(`前回はウェーブ${snap.result.reachedWave}まで守った！`, `Last time we held until wave ${snap.result.reachedWave}!`)
      : '';
    disabled = true;
  } else if (credit < c.actionCostSats) {
    label = L('チャージして出撃！', 'Top up to defend!');
    sub = L(`1回 ${c.actionCostSats} sats`, `${c.actionCostSats} sats per move`);
  } else {
    label = L('おすすめで出撃！', 'Auto defend!');
    sub = v.recommend ? describePlan(v.recommend, snap.enemies, locale) : L('いちばん役立つ一手', 'The most useful move');
  }

  const sel = selected ? v.regions[selected] : null;
  const selEnemies = selected ? snap.enemies.filter((e) => e.regionId === selected) : [];
  const selThreat = selected ? v.threats[selected] : null;
  const canAct = live && credit >= c.actionCostSats;

  const moveBtn = (action: Exclude<PlayerAction, 'AUTO'>, enabled: boolean, extra?: string) => {
    const a = ACTION_LABELS[action];
    return (
      <button
        key={action}
        type="button"
        disabled={!live || !enabled}
        onClick={() => act(action, selected ?? undefined, action === 'RAIJIN' ? (target ?? undefined) : undefined)}
        className="sw-btn sw-focus flex flex-col items-start bg-white/10 px-3 py-2 text-left ring-1 ring-white/20 disabled:opacity-40"
        data-testid={`move-${action}`}
      >
        <span className="text-lg font-black">
          {a.icon} {L(a.ja, a.en)}
        </span>
        <span className="text-xs font-bold text-off/75">{extra ?? L(a.hintJa, a.hintEn)}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="controller">
      {/* Who am I */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-bold text-off/85">
          🛡 {L('地球防衛軍', 'Earth Defense')} ・ <span data-testid="my-name">{me?.nickname ?? session.nickname}</span>
        </div>
        <button type="button" className="sw-focus rounded-full border border-line px-3 py-1 text-xs font-bold" onClick={() => setNameEdit(nameEdit === null ? (me?.nickname ?? session.nickname) : null)}>
          ✏️ {L('名前', 'Name')}
        </button>
      </div>
      {nameEdit !== null && (
        <div className="sw-panel flex flex-col gap-1 p-2 text-sm font-bold">
          <span>{L('会場の画面に出す名前（12文字まで）', 'Name on the big screen (max 12)')}</span>
          <div className="flex gap-2">
            <input
              className="sw-focus min-w-0 flex-1 rounded-lg border border-line bg-black/40 px-3 py-2 text-base"
              maxLength={24}
              value={nameEdit}
              onChange={(e) => setNameEdit(e.target.value)}
              autoComplete="off"
            />
            <button type="button" className="sw-btn bg-amber px-3 text-navy" onClick={() => void saveName()}>
              {L('決定', 'Save')}
            </button>
          </div>
          <span className="text-xs font-normal text-off/60">
            {L('本名・連絡先は入れないでください。不適切な名前は非表示になります。', 'No real names or contacts. Inappropriate names are hidden.')}
          </span>
        </div>
      )}

      {/* Situation */}
      <section className="sw-panel grid gap-1 p-3 text-sm" aria-live="polite" data-testid="battle-status">
        <div className="flex items-baseline justify-between gap-2">
          <div className="sw-display text-xl font-black">
            {L(`ウェーブ ${snap.wave}`, `Wave ${snap.wave}`)}
            {snap.enemies.some((e) => e.kind === 'MOTHERSHIP') && <span className="ml-2 text-base text-fuchsia-300">🪐 {L('母艦', 'Mothership')}</span>}
          </div>
          <FallMeter fallen={v.fallenCount} limit={c.fallLimit} locale={locale} />
        </div>
        {live && <TurnGauge left={v.turnLeft} total={c.actionsPerTurn} locale={locale} />}
        {live && <ComboGauge combo={snap.combo} max={c.comboGaugeMax} locale={locale} />}
        {live && v.doomed.length > 0 && (
          <div className="rounded bg-danger/25 px-2 py-1 font-black text-white" data-testid="doomed">
            ⚠ {L(`${v.doomed.map((id) => regionName(id, 'ja')).join('・')}があぶない！ 次の敵ターンでとられる`, `${v.doomed.map((id) => regionName(id, 'en')).join(', ')} will fall at the next alien turn!`)}
          </div>
        )}
      </section>

      {/* The big button */}
      <div className="relative flex flex-col items-center py-1">
        <button
          type="button"
          onClick={() => act('AUTO')}
          disabled={disabled}
          className="sw-focus relative flex w-full select-none flex-col items-center justify-center rounded-3xl px-4 py-6 font-black transition-transform active:scale-[0.97] disabled:opacity-45"
          style={{
            background: 'linear-gradient(135deg, #FFC46B, #F7931A 45%, #25C8D7)',
            color: '#070D1A',
            boxShadow: '0 8px 0 #0B5C6B, 0 0 40px #F7931A55',
            touchAction: 'manipulation',
          }}
          data-testid="auto-button"
        >
          <span className="text-5xl leading-none" aria-hidden>
            ⚡🌀
          </span>
          <span className="sw-display mt-2 text-center text-3xl leading-tight">{label}</span>
          <span className="mt-1 text-center text-sm font-bold opacity-85" data-testid="auto-plan">
            {sub}
          </span>
          {live && credit >= c.actionCostSats && (
            <span className="mt-1 text-xs font-bold opacity-75">{L(`1回 ${c.actionCostSats} sats`, `${c.actionCostSats} sats`)}</span>
          )}
        </button>
        {flash && (
          <div
            key={flash.id}
            role="status"
            className={`sw-banner-in pointer-events-none absolute -top-2 rounded-full px-4 py-1 text-lg font-black shadow-lg ${
              flash.tone === 'big'
                ? 'bg-yellow-300 text-navy'
                : flash.tone === 'warn'
                  ? 'bg-danger text-white'
                  : flash.tone === 'alien'
                    ? 'bg-fuchsia-700 text-white'
                    : flash.tone === 'info'
                      ? 'bg-black/85 text-off'
                      : 'bg-navy-3 text-off ring-1 ring-white/30'
            }`}
            data-testid="action-flash"
          >
            {flash.text}
          </div>
        )}
      </div>

      {/* Choose yourself */}
      <section className="sw-panel p-3" data-testid="manual">
        <div className="mb-1 text-sm font-black">{L('自分で選ぶ：地方をタップ', 'Or choose: tap a region')}</div>
        <JapanMap2D
          regions={snap.regions}
          enemies={snap.enemies}
          cityHpMax={c.cityHpMax}
          danger={v.danger}
          locale={locale}
          selected={selected}
          onSelect={(id) => {
            setSelected(id === selected ? null : id);
            setTarget(null);
          }}
          className="mx-auto h-64 w-full"
        />
        {sel && selThreat && (
          <div className="mt-2 grid gap-2" data-testid="region-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <span className="sw-display text-xl font-black">{regionName(sel.regionId, locale)}</span>
              <span className="text-sm font-bold">
                {sel.fallen ? (
                  <span className="text-fuchsia-300">👾 {L('とられた！ 敵を全部倒すと奪還', 'Captured! Clear it to liberate')}</span>
                ) : (
                  <>
                    🏙 {sel.cityHp}/{c.cityHpMax}
                    {sel.shield > 0 && ` ・ 🛡${sel.shield}`}
                    {selThreat.damageNext > 0 && (
                      <span className={selThreat.willFall ? 'ml-1 text-danger' : 'ml-1 text-yellow-300'}>
                        ・ {L(`次の敵ターン −${selThreat.damageNext}`, `next turn −${selThreat.damageNext}`)}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
            {selEnemies.length > 0 ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label={L('ねらう敵', 'Target')}>
                {selEnemies.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setTarget(target === e.id ? null : e.id)}
                    aria-pressed={target === e.id}
                    className={`sw-focus rounded-lg px-2 py-1 text-xs font-bold ring-1 ${target === e.id ? 'bg-amber text-navy ring-amber' : 'bg-black/40 ring-white/20'}`}
                  >
                    {enemyName(e, locale)} ❤{e.hp} ⚔{e.attack}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-off/70">
                {selThreat.landing > 0
                  ? L(`🛸 次の敵ターンに ${selThreat.landing}体 降りてくる予告`, `🛸 ${selThreat.landing} alien(s) will land here next turn`)
                  : L('ここに敵はいません', 'No aliens here')}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {moveBtn('RAIJIN', canAct && selEnemies.length > 0, target !== null ? L('選んだ敵に大ダメージ', 'Big hit on your target') : undefined)}
              {moveBtn('FUJIN', canAct && selEnemies.length > 0)}
              {moveBtn('SHIELD', canAct && !sel.fallen && sel.shield === 0, sel.shield > 0 ? L('もう結界があります', 'Already shielded') : undefined)}
              {moveBtn('COMBO', canAct && v.comboReady && selEnemies.length > 0, v.comboReady ? undefined : L(`ゲージ ${snap.combo}/${c.comboGaugeMax}`, `Gauge ${snap.combo}/${c.comboGaugeMax}`))}
            </div>
          </div>
        )}
      </section>

      {/* Credit */}
      <div className="sw-panel flex items-center justify-between gap-2 p-3">
        <div>
          <div className="text-xs text-off/70">{L('残高', 'Balance')}</div>
          <div className="font-black tabular-nums" data-testid="credit">
            <span className="sw-display text-2xl">{credit}</span> <span className="text-sm">sats</span>
            <span className="ml-2 whitespace-nowrap text-sm text-off/80">= {L(`あと${movesLeft}回`, `${movesLeft} moves`)}</span>
          </div>
          {me && (
            <div className="text-xs text-off/65">
              {L(`今回 ${me.actionsThisCampaign}回出撃 ・ 撃破 ${me.kills}体`, `This defence: ${me.actionsThisCampaign} moves ・ ${me.kills} kills`)}
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

      <details className="sw-panel p-3 text-sm">
        <summary className="cursor-pointer font-bold">{L('遊び方', 'How to play')}</summary>
        <p className="mt-2 font-bold">{ONE_LINE_RULES[locale]}</p>
        <ul className="mt-2 grid gap-1 text-off/85">
          <li>{L(`・1回 ${c.actionCostSats} sats で、雷神か風神が1回うごく`, `・Each move costs ${c.actionCostSats} sats`)}</li>
          <li>{L(`・みんなで${c.actionsPerTurn}回うごくと、エイリアンのターン（街を攻撃・新しい敵が降りてくる）`, `・After ${c.actionsPerTurn} moves by anyone, the aliens attack and land`)}</li>
          <li>{L('・⚠マークの地方は次の敵ターンでとられる。倒すか🛡結界で守ろう', '・⚠ regions fall next turn: defeat the aliens or raise a 🛡 barrier')}</li>
          <li>{L(`・とられた地方は敵を全部倒すと奪還。${c.fallLimit}地方とられたら日本陥落`, `・Clear a captured region to liberate it. ${c.fallLimit} captured = Japan falls`)}</li>
          <li>{L('・迷ったら「おすすめ」でOK。時間制限はありません', '・Not sure? Just press Auto. There is no time limit')}</li>
        </ul>
      </details>

      <p className="text-center text-xs text-off/60">
        💡 {SATS_EXPLAINER[locale]}
        {L('。チャージした分は今日ずっと使えます。うまくいかなかった一手（敵がいない等）は無料です。', '. Credit stays all day. Moves that do nothing are free.')}
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
