import { useStore, useTicker } from '@swed/client';
import { squadStrike, mechClaw, nowLine, percent } from '@swed/game-engine';
import {
  ACTION_KINDS,
  ACTION_LABEL,
  SQUADS,
  SQUAD_IDS,
  formatClock,
  isCombatPhase,
  routeProgress,
  ZONE_IDS,
  ZONES,
  zoneAt,
} from '@swed/shared';
import type { ActionKind, PublicMatchState, ZoneId } from '@swed/shared';
import { IconBolt, IconCrosshair, IconShield, IconWarning, IconWrench } from '@swed/ui-tokens';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CAPTURE } from '../capture';
import { joinInfo, store } from '../net';
import { finisher } from '../scene/cameraBus';
import { Lobby } from './Lobby';
import { Radar } from './Radar';
import { Results, REASON_LABEL } from './Results';
import { WorldMarkers } from './WorldMarkers';

/**
 * Big-screen HUD (D-033, setting D-034). A passer-by needs four things: the mothership's HP
 * to bring to zero before it reaches Earth, the squad under attack (and the shield it needs),
 * RAIJIN's armour, and the three buttons on everyone's phone — with the one to press now lit.
 * Lightning actions get a hall-wide moment.
 */

export const ACTION_ICON: Record<ActionKind, typeof IconCrosshair> = {
  ATTACK: IconCrosshair,
  DEFEND: IconShield,
  REPAIR: IconWrench,
};

export const ACTION_VAR: Record<ActionKind, string> = {
  ATTACK: 'var(--sw-action)',
  DEFEND: 'var(--sw-ally)',
  REPAIR: 'var(--sw-repair)',
};

function TopBar({ s, mt }: { s: PublicMatchState; mt: number }) {
  const remaining = s.phaseEndsAt !== null ? s.phaseEndsAt - mt : 0;
  const defended = SQUAD_IDS.filter((id) => !s.squads[id].lost).length;
  const lost = SQUAD_IDS.length - defended;
  const left = s.hints.squadsLostForDefeat - lost;
  return (
    <div className="topbar">
      <div className="brand">
        <b>SATS WARS</b>
        <span>EARTH DEFENSE</span>
      </div>
      <div className="wave">
        <span className="k">MISSION</span>
        <span className="v">エイリアン母艦を倒せ</span>
      </div>
      <div className="time">
        <span className="k">地球到達まで TO EARTH</span>
        <span className="v sw-num">{formatClock(remaining)}</span>
      </div>
      <div>
        <span className="k">参加 PLAYERS</span>
        <span className="v sw-num">
          {s.players}
          <small style={{ fontSize: 20, color: 'var(--sw-muted)' }}> 人</small>
        </span>
      </div>
      <div>
        <span className="k">残った部隊 SQUADS</span>
        <span className="v sw-num" style={{ color: lost >= 2 ? 'var(--sw-danger)' : undefined }}>
          {defended}
          <small style={{ fontSize: 20, color: 'var(--sw-muted)' }}> / {SQUAD_IDS.length}</small>
        </span>
      </div>
      <div className="context">
        <span className="k">負け条件 LOSE IF</span>
        <span className="v">{left > 0 ? `あと${left}部隊やられたら負け` : '—'}</span>
      </div>
    </div>
  );
}

function BossBar({ s, mt }: { s: PublicMatchState; mt: number }) {
  if (!s.boss) return null;
  const hp = percent(s.boss.hp, s.boss.maxHp);
  const p = routeProgress(s, s.hints.battleMs, mt);
  const zone = zoneAt(p);
  return (
    <div className="bossbar big">
      <div className="name">
        エイリアン母艦 NULL CORE <span className="sw-num">{hp}%</span>
      </div>
      <div className="bar">
        <i style={{ width: `${hp}%` }} />
      </div>
      {/* Where the mothership is on its way to Earth: the time limit, drawn as a journey. */}
      <div className="route" aria-label={`現在地 ${ZONES[zone].nameJa}`}>
        {ZONE_IDS.map((z) => (
          <span key={z} className={`seg ${z.toLowerCase()}${z === zone ? ' on' : ''}`}>
            {ZONES[z].nameJa}
          </span>
        ))}
        <i className="flown" style={{ width: `${p * 100}%` }} />
        <b className="ship" style={{ left: `${p * 100}%` }} />
      </div>
      <div className="goal">
        地球に着く前に「撃つ」で HP をゼロに / DESTROY IT BEFORE IT REACHES EARTH
      </div>
    </div>
  );
}

/** RAIJIN's armour and the shared shield, left side, big enough to read from the back. */
function MechPanel({ s, mt }: { s: PublicMatchState; mt: number }) {
  const strike = squadStrike(s);
  const claw = mechClaw(s);
  const armour = percent(s.mechHp, s.mechMax);
  const need = strike ? strike.damage : null;
  const enough = need !== null && s.shield >= need;
  return (
    <div className="mechpanel sw-frame">
      <div className={`mp-row repair${armour <= 30 ? ' low' : ''}`}>
        <span className="k">雷神の装甲 RAIJIN ARMOUR</span>
        <span className="v sw-num">{armour}%</span>
        <div className="bar">
          <i style={{ width: `${armour}%` }} />
        </div>
        <span className="hint">
          {claw
            ? `母艦の攻撃まで ${Math.max(0, (claw.impactAt - mt) / 1000).toFixed(0)}秒（−${claw.damage}）→「直す」で回復`
            : '殴られたら「直す」で回復'}
        </span>
      </div>
      <div className={`mp-row ally${enough ? ' ok' : ''}`}>
        <span className="k">シールド SHIELD</span>
        <span className="v sw-num">
          {s.shield}
          {need !== null ? <small> / {need}</small> : null}
        </span>
        <div className="bar">
          <i style={{ width: `${percent(s.shield, s.shieldMax)}%` }} />
          {need !== null ? (
            <b className="need" style={{ left: `${percent(need, s.shieldMax)}%` }} />
          ) : null}
        </div>
        <span className="hint">
          {need !== null
            ? enough
              ? '足りている！ 着弾まで保とう'
              : `「守る」で ${need} まで貯めると部隊を守れる`
            : '攻撃予告が出たら「守る」'}
        </span>
      </div>
    </div>
  );
}

/** The announced squad strike: which squad, how long, how much shield. */
function ThreatCall({ s, mt }: { s: PublicMatchState; mt: number }) {
  const strike = squadStrike(s);
  if (!strike || strike.target.type !== 'SQUAD') return null;
  const squad = SQUADS[strike.target.squadId];
  const secs = Math.max(0, (strike.impactAt - mt) / 1000);
  const enough = s.shield >= strike.damage;
  return (
    <div className={`threat-call${enough ? ' ok' : ''}`} role="alert">
      <IconWarning size={40} />
      <div>
        <b>
          {squad.nameJa}に攻撃 <span className="sw-num">{secs.toFixed(1)}</span>秒
        </b>
        <span>
          {enough
            ? `シールド ${s.shield} / ${strike.damage} — 守れる！`
            : `みんなで「守る」！ シールド ${s.shield} / ${strike.damage}`}
        </span>
      </div>
    </div>
  );
}

/** The three buttons on every phone, with the one to press now lit and recent activity. */
function ActionBar({
  s,
  mt,
  activity,
}: {
  s: PublicMatchState;
  mt: number;
  activity: Record<ActionKind, number>;
}) {
  const line = nowLine(s, mt);
  return (
    <div className="actbar">
      {ACTION_KINDS.map((kind) => {
        const Icon = ACTION_ICON[kind];
        const rec = line.action === kind;
        const sign = kind === 'ATTACK' ? '' : '+';
        return (
          <div
            key={kind}
            className={`ab${rec ? ' rec' : ''}`}
            style={{ ['--acc' as string]: ACTION_VAR[kind] }}
          >
            <Icon size={44} />
            <div className="ab-name">
              <b>{ACTION_LABEL[kind].ja}</b>
              <span>{ACTION_LABEL[kind].en}</span>
            </div>
            <div className="ab-what">
              <span>
                タップ（無料）{' '}
                <b className="sw-num">
                  {sign}
                  {s.hints.free[kind]}
                </b>
              </span>
              <span className="paid">
                <IconBolt size={18} /> {s.hints.paidAmountSats} sats{' '}
                <b className="sw-num">
                  {sign}
                  {s.hints.paid[kind]}
                </b>
              </span>
            </div>
            <div className="ab-live sw-num">{activity[kind] > 0 ? `×${activity[kind]}` : ''}</div>
            {rec ? <em className="ab-tag">いまこれ！</em> : null}
          </div>
        );
      })}
    </div>
  );
}

function NowCard({ s, mt }: { s: PublicMatchState; mt: number }) {
  const line = nowLine(s, mt);
  return (
    <div className="now-card sw-frame" style={{ ['--acc' as string]: ACTION_VAR[line.action] }}>
      <span className="lbl">今やること NOW</span>
      <span className="txt">{line.ja}</span>
    </div>
  );
}

/** Small join QR in the corner: people can join mid-fight (no seats, no limit). */
function JoinMini() {
  const join = useSyncExternalStore(joinInfo.subscribe, joinInfo.get, joinInfo.get);
  if (!join) return null;
  return (
    <div className="qr-mini sw-frame">
      <img src="/api/public/join.svg" alt={`Join: ${join.joinUrl}`} />
      <span>
        途中参加OK
        <small>SCAN TO JOIN</small>
      </span>
    </div>
  );
}

interface Moment {
  id: number;
  tone: 'bolt' | 'ok' | 'danger';
  big: string;
  sub: string;
  until: number;
}

/** One big line in the middle for what the hall should see: Lightning, saves, losses. */
function useMoment(): Moment | null {
  const [m, setM] = useState<Moment | null>(null);
  useEffect(() => {
    let n = 0;
    return store.onEvent(({ payload: e }) => {
      const show = (tone: Moment['tone'], big: string, sub: string, ms = 2_600) =>
        setM({ id: ++n, tone, big, sub, until: performance.now() + ms });
      if (e.type === 'action' && e.paid) {
        const what =
          e.kind === 'ATTACK'
            ? `母艦に ${e.value} ダメージ`
            : e.kind === 'DEFEND'
              ? `シールド +${e.value}`
              : `雷神の装甲 +${e.value}`;
        // Who paid is never shown (spec §7.4); what money moved always is.
        const tag = e.bot
          ? 'DEMO（デモ・お金は動きません）'
          : e.virtual
            ? 'VIRTUAL（テスト・お金は動きません）'
            : 'Lightning 着金';
        show('bolt', `21 sats で 大きく${ACTION_LABEL[e.kind].ja}！`, `${what} — ${tag}`, 3_200);
      }
      if (e.type === 'strike_blocked') {
        show('ok', `${SQUADS[e.squadId].nameJa}を守った！`, 'シールドで攻撃を防いだ / SQUAD SAVED');
      }
      if (e.type === 'strike_hit') {
        show('danger', `${SQUADS[e.squadId].nameJa} 壊滅`, 'シールドが足りなかった / SQUAD LOST');
      }
      if (e.type === 'mech_hit') {
        show('danger', `雷神 被弾 −${e.damage}`, '「直す」で装甲を回復 / REPAIR RAIJIN', 1_800);
      }
    });
  }, []);
  return m;
}

/** Taps per action over the last few seconds (the server sends them batched). */
function useActivity(now: number): Record<ActionKind, number> {
  const [log, setLog] = useState<Array<{ at: number; kind: ActionKind; n: number }>>([]);
  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type !== 'action' || e.paid) return;
        const at = performance.now();
        setLog((l) => [...l.filter((x) => at - x.at < 5_000), { at, kind: e.kind, n: e.count }]);
      }),
    [],
  );
  return useMemo(() => {
    const out: Record<ActionKind, number> = { ATTACK: 0, DEFEND: 0, REPAIR: 0 };
    for (const x of log) if (now - x.at < 5_000) out[x.kind] += x.n;
    return out;
  }, [log, now]);
}

/**
 * The mothership crossing into the next area (Mars → Moon → Earth): a short call, worked out
 * from the battle clock every display shares, so all screens call it at the same moment.
 */
function useZoneCall(
  s: PublicMatchState | undefined,
  mt: number,
): { zone: ZoneId; until: number } | null {
  const last = useRef<ZoneId | null>(null);
  const [call, setCall] = useState<{ zone: ZoneId; until: number } | null>(null);
  const zone = s && s.phase === 'BATTLE' ? zoneAt(routeProgress(s, s.hints.battleMs, mt)) : null;
  useEffect(() => {
    if (zone === null) {
      last.current = null;
      return;
    }
    if (last.current !== null && last.current !== zone)
      setCall({ zone, until: performance.now() + 3_200 });
    last.current = zone;
  }, [zone]);
  return call;
}

/** A few seconds when the battle begins: the whole game in one line. */
function useBattleIntro(): number {
  const [until, setUntil] = useState(0);
  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        if (e.type === 'phase_changed' && e.to === 'BATTLE') setUntil(performance.now() + 5_000);
      }),
    [],
  );
  return until;
}

export function Hud({ audioReady }: { audioReady: boolean }) {
  const st = useStore(store);
  const now = useTicker(100);
  const moment = useMoment();
  const activity = useActivity(now);
  const introUntil = useBattleIntro();
  const snap = st.snap?.state;
  const mt = store.matchTime(now);
  const zoneCall = useZoneCall(snap, mt);
  const combat = snap ? isCombatPhase(snap.phase) : false;
  const countdown =
    snap?.phase === 'COUNTDOWN' && snap.phaseEndsAt !== null
      ? Math.ceil((snap.phaseEndsAt - mt) / 1000)
      : 0;
  const outcome = snap?.result;
  // The finishing blow: the picture leads, the HUD fades almost out (spec §9.1).
  const finishing = now < finisher.until;

  return (
    <>
      {!snap || snap.phase === 'LOBBY' || snap.phase === 'COUNTDOWN' ? (
        <Lobby s={snap} mt={mt} />
      ) : null}
      {snap?.phase === 'COUNTDOWN' ? (
        <div className="center-call">
          <div className="big sw-num">{String(Math.max(1, countdown)).padStart(2, '0')}</div>
          <div className="sub">LAUNCH SEQUENCE 出撃準備</div>
        </div>
      ) : null}
      {snap?.phase === 'DEPLOYMENT' ? (
        <>
          <div className="banner">RAIJIN-01 LAUNCH 出撃</div>
          <div className="center-call" style={{ top: 860 }}>
            <div className="sub">まもなく戦闘開始 — スマホの3つのボタンを用意 / GET READY</div>
          </div>
        </>
      ) : null}
      {snap && (combat || snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') ? (
        <div className="hud-dim" style={{ opacity: finishing ? 0.12 : combat ? 1 : 0.25 }}>
          <TopBar s={snap} mt={mt} />
          {combat ? (
            <>
              <BossBar s={snap} mt={mt} />
              <ThreatCall s={snap} mt={mt} />
              <MechPanel s={snap} mt={mt} />
              <NowCard s={snap} mt={mt} />
              <Radar s={snap} mt={mt} />
              <WorldMarkers s={snap} mt={mt} />
              <ActionBar s={snap} mt={mt} activity={activity} />
              <JoinMini />
            </>
          ) : null}
        </div>
      ) : null}
      {snap && (snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') && outcome ? (
        <div className={`center-call ${snap.phase === 'VICTORY' ? 'victory' : 'defeat'}`}>
          <div className="big">{snap.phase === 'VICTORY' ? 'VICTORY' : 'DEFEAT'}</div>
          <div className="sub">
            {snap.phase === 'VICTORY' ? '撃退成功' : '防衛失敗'} / {REASON_LABEL[outcome.reason].ja}
          </div>
        </div>
      ) : null}
      {snap?.phase === 'RESULTS' ? <Results s={snap} mt={mt} /> : null}
      {snap?.paused && !CAPTURE ? (
        <div className="banner">作戦一時停止 OPERATION PAUSED</div>
      ) : null}
      {st.reconnecting || (!st.connected && st.snap) ? (
        <div className="banner danger">SIGNAL LOST 再接続中</div>
      ) : null}
      {!st.snap && !st.reconnecting ? (
        <div className="banner">CONNECTING ゲームサーバーに接続中</div>
      ) : null}
      {combat && now < introUntil ? (
        <div className="act-intro" role="status">
          <span className="no">MISSION</span>
          <b>エイリアン母艦を地球に着く前に倒せ</b>
          <span className="en">ATTACK · DEFEND · REPAIR</span>
          <p>スマホの3つのボタン — 撃つ・守る・直す。光っているボタンを押そう</p>
        </div>
      ) : null}
      {combat &&
      !finishing &&
      zoneCall &&
      now < zoneCall.until &&
      !(moment && now < moment.until) ? (
        <div
          className={`moment zone ${zoneCall.zone.toLowerCase()}`}
          role="status"
          key={zoneCall.until}
        >
          <b>{ZONES[zoneCall.zone].nameJa}に突入</b>
          <span>
            {zoneCall.zone === 'EARTH'
              ? '地球が目の前！ 最後のチャンス / ENTERING EARTH ORBIT — LAST CHANCE'
              : `母艦が地球に近づいている — 急げ！ / ENTERING ${ZONES[zoneCall.zone].nameEn}`}
          </span>
        </div>
      ) : null}
      {combat && !finishing && moment && now < moment.until ? (
        <div className={`moment ${moment.tone}`} role="status" key={moment.id}>
          <b>{moment.big}</b>
          <span>{moment.sub}</span>
        </div>
      ) : null}
      <div className="provisional">PROVISIONAL 3D 仮モデル（Phase 5 で本番アートに差し替え）</div>
      {!audioReady ? (
        <div className="sound-hint">CLICK OR ANY KEY: SOUND ON クリックで音声有効化</div>
      ) : null}
    </>
  );
}
