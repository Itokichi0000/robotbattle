import { useStore, useTicker } from '@swed/client';
import { percent } from '@swed/game-engine';
import {
  CITIES,
  CITY_IDS,
  DIRECTION_LABEL,
  formatClock,
  isCombatPhase,
  PARTS,
  PHASE_LABEL,
  ROLES,
  SEATS,
  shieldSeatFor,
} from '@swed/shared';
import type { PublicMatchState, RoleId, SeatId, ThreatState } from '@swed/shared';
import {
  IconBolt,
  IconCrosshair,
  IconLink,
  IconShield,
  IconWarning,
  IconWrench,
  ROLE_VAR,
} from '@swed/ui-tokens';
import { useEffect, useMemo, useState } from 'react';
import { CAPTURE } from '../capture';
import { store } from '../net';
import { Lobby } from './Lobby';
import { Radar } from './Radar';
import { Results, REASON_LABEL } from './Results';
import { WorldMarkers } from './WorldMarkers';

/** Japanese first, English beneath, on the big screen (spec §3.4). */
export function JaEn({ ja, en }: { ja: string; en: string }) {
  return (
    <>
      {ja}
      <span className="sw-sr-only"> / </span>
      <small
        style={{
          display: 'block',
          fontSize: '0.55em',
          letterSpacing: '0.2em',
          color: 'var(--sw-muted)',
        }}
      >
        {en}
      </small>
    </>
  );
}

function threatTargetLabel(th: ThreatState): { ja: string; en: string } {
  if (th.target.type === 'CITY') {
    const c = CITIES[th.target.cityId];
    return { ja: c.nameJa, en: c.nameEn };
  }
  const p = PARTS[th.target.part];
  return { ja: `RAIJIN ${p.labelJa}`, en: `RAIJIN ${p.labelEn}` };
}

function TopBar({ s, mt }: { s: PublicMatchState; mt: number }) {
  const label = PHASE_LABEL[s.phase];
  const remaining =
    s.combatEndsAt !== null ? s.combatEndsAt - mt : s.phaseEndsAt !== null ? s.phaseEndsAt - mt : 0;
  const core = percent(s.coreHp, s.coreMax);
  const defended = CITY_IDS.filter((id) => !s.cities[id].lost).length;
  const next = [...s.threats].sort((a, b) => a.impactAt - b.impactAt)[0];
  const context =
    next && next.target.type === 'CITY'
      ? `${CITIES[next.target.cityId].nameEn} DEFENSE`
      : 'JAPAN DEFENSE LINE';
  return (
    <div className="topbar">
      <div className="brand">
        <b>SATS WARS</b>
        <span>EARTH DEFENSE</span>
      </div>
      <div className="wave">
        <span className="k">{label.ja}</span>
        <span className="v sw-num">{label.en}</span>
      </div>
      <div className="meter">
        <div className="row">
          <span className="k">CORE 機体</span>
          <span className="v sw-num" style={{ color: core < 35 ? 'var(--sw-danger)' : undefined }}>
            {core}%
          </span>
        </div>
        <div
          className="bar"
          style={{ ['--bar' as string]: core < 35 ? 'var(--sw-danger)' : 'var(--sw-text)' }}
        >
          <i style={{ width: `${core}%` }} />
        </div>
      </div>
      <div className="meter">
        <div className="row">
          <span className="k">TEAM SYNC 連携</span>
          <span className="v sw-num" style={{ color: 'var(--sw-ally)' }}>
            {s.teamSync}%
          </span>
        </div>
        <div className="bar">
          <i style={{ width: `${s.teamSync}%` }} />
        </div>
      </div>
      <div>
        <span className="k">CITIES 防衛都市</span>
        <span className="v sw-num">
          {defended}
          <small style={{ fontSize: 20, color: 'var(--sw-muted)' }}> / {CITY_IDS.length}</small>
        </span>
      </div>
      <div className="time">
        <span className="k">TIME 残り</span>
        <span className="v sw-num">{formatClock(remaining)}</span>
      </div>
      <div>
        <span className="k">PILOTS 搭乗</span>
        <span className="v sw-num">
          {s.humans}
          <small style={{ fontSize: 20, color: 'var(--sw-muted)' }}> / 8</small>
        </span>
      </div>
      <div className="context">
        <span className="k">{next ? 'PRIORITY 最優先' : 'STATUS 状況'}</span>
        <span className="v" style={{ color: next ? 'var(--sw-danger)' : 'var(--sw-ally)' }}>
          {context}
        </span>
      </div>
    </div>
  );
}

function BossBar({ s, mt }: { s: PublicMatchState; mt: number }) {
  if (!s.boss) return null;
  const boss = s.enemies.find((e) => e.id === s.boss!.id);
  const weak = boss ? boss.weakUntil > mt : false;
  const hp = percent(s.boss.hp, s.boss.maxHp);
  return (
    <div className="bossbar">
      <div className="name">NULL CORE</div>
      <div className="bar">
        <i style={{ width: `${hp}%` }} />
      </div>
      {weak ? <div className="exposed">WEAK POINT EXPOSED 弱点露出中</div> : null}
    </div>
  );
}

/** One urgent warning at a time (spec §9.1: right side, about one timed warning). */
function ContextAlert({ s, mt }: { s: PublicMatchState; mt: number }) {
  const sorted = [...s.threats].sort((a, b) => a.impactAt - b.impactAt);
  const th = sorted[0];
  if (!th) return null;
  const secs = Math.max(0, (th.impactAt - mt) / 1000);
  const target = threatTargetLabel(th);
  const dir = DIRECTION_LABEL[th.dir];
  const guard = shieldSeatFor(th.dir);
  return (
    <div className="alert sw-frame">
      <div className="kick">
        <IconWarning size={20} />
        {th.kind === 'CORE_LANCE' ? 'CORE LANCE 主砲照射' : 'INCOMING 攻撃予告'}
      </div>
      <div className="when sw-num">{secs.toFixed(1)}s</div>
      <div className="what">
        <span>
          {target.ja} <small style={{ color: 'var(--sw-muted)' }}>{target.en}</small>
        </span>
        <span className="dir">
          {dir.ja} {dir.en}
        </span>
      </div>
      <div className="more">
        {SEATS[guard].labelJa} {SEATS[guard].labelEn} が担当
        {sorted.length > 1 ? `  /  +${sorted.length - 1} 件` : ''}
      </div>
    </div>
  );
}

function seatName(s: PublicMatchState, id: SeatId) {
  const seat = s.seats[id];
  if (seat.occupied)
    return { name: seat.displayName ?? 'PILOT', auto: false, offline: !seat.connected };
  return { name: seat.auto ? 'AUTO SUPPORT' : '空席 EMPTY', auto: true, offline: false };
}

const ROLE_ICON: Record<RoleId, typeof IconCrosshair> = {
  GUNNER: IconCrosshair,
  DEFENSE: IconShield,
  POWER: IconBolt,
  ENGINEER: IconWrench,
};

function SystemStrip({
  s,
  mt,
  flashes,
}: {
  s: PublicMatchState;
  mt: number;
  flashes: Record<RoleId, number>;
}) {
  const sys = (
    role: RoleId,
    state: string,
    bar: number,
    seatTags: Record<string, string>,
    extra?: React.ReactNode,
  ) => {
    const def = ROLES[role];
    const Icon = ROLE_ICON[role];
    return (
      <div
        key={`${role}${flashes[role]}`}
        className={`sys sw-frame${flashes[role] ? ' flash' : ''}`}
        style={{ ['--acc' as string]: ROLE_VAR[role] }}
      >
        <div className="head">
          <span className="no sw-num">C{def.no}</span>
          <Icon size={20} />
          <b>{def.labelEn}</b>
          <span className="ja">{def.labelJa}</span>
          <span className="state">{state}</span>
        </div>
        <div className="seats">
          {def.seats.map((id) => {
            const n = seatName(s, id);
            return (
              <div className="seat" key={id}>
                <b className={n.auto ? 'auto' : undefined}>{n.name}</b>
                {SEATS[id].labelJa}{' '}
                <span className="tag">{n.offline ? 'RECONNECTING' : seatTags[id]}</span>
              </div>
            );
          })}
        </div>
        {extra}
        <div className="bar">
          <i style={{ width: `${Math.round(bar)}%` }} />
        </div>
      </div>
    );
  };
  const g = (id: 'GUNNER_L' | 'GUNNER_R') => {
    const gs = s.gunners[id];
    if (!gs.targetId) return 'STANDBY';
    if (mt < gs.readyAt)
      return mt < gs.lastFiredAt + s.hints.weaponCooldownMs ? 'COOLING' : 'CHARGING';
    return 'READY';
  };
  const d = (id: 'SHIELD_L' | 'SHIELD_R') => {
    const sh = s.shields[id];
    if (sh.dir && sh.activeFrom <= mt && mt <= sh.activeUntil) return `ACTIVE ${sh.dir}`;
    if (mt < sh.cooldownUntil) return `COOLDOWN ${((sh.cooldownUntil - mt) / 1000).toFixed(0)}s`;
    return id === 'SHIELD_L' ? 'FRONT / LEFT' : 'RIGHT / REAR';
  };
  const parts = Object.entries(s.parts) as Array<[keyof typeof PARTS, number]>;
  const worst = parts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const avg = parts.reduce((a, [, v]) => a + v, 0) / parts.length;
  const lane = (v: number) => (v / s.hints.laneMax) * 100;
  const dist = s.distribution;
  return (
    <div className="strip">
      {sys('GUNNER', 'FIRE / LOCK', lane(s.energy.weapon), {
        GUNNER_L: g('GUNNER_L'),
        GUNNER_R: g('GUNNER_R'),
      })}
      {sys('DEFENSE', 'SHIELD / TIMING', lane(s.energy.shield), {
        SHIELD_L: d('SHIELD_L'),
        SHIELD_R: d('SHIELD_R'),
      })}
      {sys(
        'POWER',
        `W${dist.weapon} S${dist.shield} M${dist.mobility} R${dist.repair}`,
        lane((s.energy.weapon + s.energy.shield + s.energy.mobility + s.energy.repair) / 4),
        {
          POWER_CORE: 'ROUTING',
          POWER_ROUTER: 'GRID OK',
        },
      )}
      {sys('ENGINEER', `${PARTS[worst[0]].labelEn} ${worst[1]}%`, avg, {
        ENGINEER_LEGS: 'LEGS / JOINTS',
        ENGINEER_CORE: 'CORE / GUNS',
      })}
    </div>
  );
}

interface FeedItem {
  id: number;
  text: string;
  kind: 'combo' | 'kill' | 'guard' | 'danger' | 'info';
  until: number;
}

const FEED_ACC: Record<FeedItem['kind'], string> = {
  combo: 'var(--sw-ally)',
  kill: 'var(--sw-action)',
  guard: 'var(--sw-ally)',
  danger: 'var(--sw-danger)',
  info: 'var(--sw-line)',
};

function useFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  useEffect(() => {
    let n = 0;
    const push = (text: string, kind: FeedItem['kind']) =>
      setItems((xs) => [
        ...xs.slice(-2),
        { id: ++n, text, kind, until: performance.now() + 3_200 },
      ]);
    const off = store.onEvent(({ payload: e }) => {
      const snap = store.getState().snap?.state;
      switch (e.type) {
        case 'team_combo':
          push(`LINK ESTABLISHED  +${e.gain} SYNC  連携成立`, 'combo');
          break;
        case 'enemy_destroyed':
          if (e.kind === 'NULL_CORE') push('NULL CORE DESTROYED  撃破', 'kill');
          else if (e.bySeat && snap)
            push(
              `${snap.seats[e.bySeat].displayName ?? SEATS[e.bySeat].labelEn}  ${e.kind} DOWN  撃墜`,
              'kill',
            );
          break;
        case 'threat_blocked':
          if (!e.auto && e.perfect)
            push(`PERFECT GUARD  完全防御  ${DIRECTION_LABEL[e.dir].en}`, 'guard');
          break;
        case 'threat_intercepted':
          push('INTERCEPTED  攻撃前に撃墜', 'guard');
          break;
        case 'city_lost':
          push(`${CITIES[e.cityId].nameJa} ${CITIES[e.cityId].nameEn} 陥落 LOST`, 'danger');
          break;
        case 'enemy_spawned':
          if (e.kind === 'NULL_CORE') push('NULL CORE 出現  BOSS INBOUND', 'danger');
          break;
        case 'seat_assigned':
          push(`${e.displayName}  ${SEATS[e.seatId].labelJa} 搭乗`, 'info');
          break;
      }
    });
    const id = setInterval(
      () => setItems((xs) => xs.filter((x) => x.until > performance.now())),
      500,
    );
    return () => {
      off();
      clearInterval(id);
    };
  }, []);
  return items;
}

function useRoleFlashes(): Record<RoleId, number> {
  const [f, setF] = useState<Record<RoleId, number>>({
    GUNNER: 0,
    DEFENSE: 0,
    POWER: 0,
    ENGINEER: 0,
  });
  useEffect(
    () =>
      store.onEvent(({ payload: e }) => {
        const bump = (r: RoleId) => setF((x) => ({ ...x, [r]: x[r] + 1 }));
        if (e.type === 'weapon_fired' && !e.auto) bump('GUNNER');
        if (e.type === 'threat_blocked') bump('DEFENSE');
        if (e.type === 'part_repaired') bump('ENGINEER');
      }),
    [],
  );
  return f;
}

export function Hud({ audioReady }: { audioReady: boolean }) {
  const st = useStore(store);
  const now = useTicker(100);
  const feed = useFeed();
  const flashes = useRoleFlashes();
  const snap = st.snap?.state;
  const mt = store.matchTime(now);
  const combat = snap ? isCombatPhase(snap.phase) : false;
  const countdown =
    snap?.phase === 'COUNTDOWN' && snap.phaseEndsAt !== null
      ? Math.ceil((snap.phaseEndsAt - mt) / 1000)
      : 0;
  const outcome = useMemo(() => snap?.result, [snap?.result]);

  return (
    <>
      {!snap || snap.phase === 'ATTRACT' || snap.phase === 'LOBBY' || snap.phase === 'COUNTDOWN' ? (
        <Lobby s={snap} attract={!snap || snap.phase === 'ATTRACT'} />
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
            <div className="sub">着地まで操作は受付停止 / CONTROLS ARM ON LANDING</div>
          </div>
        </>
      ) : null}
      {snap && (combat || snap.phase === 'VICTORY' || snap.phase === 'DEFEAT') ? (
        <div className="hud-dim" style={{ opacity: combat ? 1 : 0.25 }}>
          <TopBar s={snap} mt={mt} />
          {combat ? (
            <>
              <BossBar s={snap} mt={mt} />
              <ContextAlert s={snap} mt={mt} />
              <Radar s={snap} mt={mt} />
              <WorldMarkers s={snap} mt={mt} />
              <SystemStrip s={snap} mt={mt} flashes={flashes} />
              <div className="feed">
                {feed.map((f) => (
                  <div
                    key={f.id}
                    className={`item ${f.kind === 'combo' ? 'combo' : ''}`}
                    style={{ ['--acc' as string]: FEED_ACC[f.kind] }}
                  >
                    {f.kind === 'combo' ? (
                      <IconLink size={22} style={{ verticalAlign: '-4px', marginRight: 8 }} />
                    ) : null}
                    {f.text}
                  </div>
                ))}
              </div>
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
      <div className="provisional">PROVISIONAL 3D 仮モデル / PHASE 1</div>
      {!audioReady ? (
        <div className="sound-hint">CLICK OR ANY KEY: SOUND ON クリックで音声有効化</div>
      ) : null}
    </>
  );
}
