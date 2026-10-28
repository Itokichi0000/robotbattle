import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ActionResult, Enemy, MatchState, PlayerAction, RegionId, RegionState } from '@sats-wars/shared';
import {
  ACTION_ERROR_LABELS,
  ACTION_LABELS,
  CHEER_EMOJIS,
  ENEMY_LABELS,
  REGION_CENTROIDS,
  REGION_IDS,
  REGION_INFO,
  REGION_OUTLINES,
  actionsFor,
  mapBounds,
} from '@sats-wars/shared';
import { type PlannedAction, type RegionThreat, recommendAction, threats } from '@sats-wars/game-engine';
import { ArenaDirector, ArenaScene, type Banner, type BannerTone, SfxEngine, type SfxName, cueFromEvent } from '@sats-wars/three-game';
import { LocalMatch, STARTING_CREDIT, type SoloOptions } from './localMatch';

const TONE: Record<BannerTone, string> = {
  ally: '#FFE27A',
  alien: '#C98BFF',
  neutral: '#EFF5FF',
  RAIJIN: '#F7931A',
  FUJIN: '#25C8D7',
};

export function App() {
  const [options, setOptions] = useState<SoloOptions | null>(null);
  if (!options) return <Setup onStart={setOptions} />;
  return <Game options={options} onSettings={() => setOptions(null)} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup({ onStart }: { onStart: (o: SoloOptions) => void }) {
  const [nickname, setNickname] = useState('');
  const [crowd, setCrowd] = useState(3);
  return (
    <main className="setup">
      <section>
        <h1 className="title">
          <span className="r">SATS</span> <span className="f">WARS</span>
        </h1>
        <div className="versus">
          地球防衛軍 <span className="raijin">雷神</span>＆<span className="fujin">風神</span>
        </div>
        <p className="oneline">
          エイリアンが日本に攻めてきた！
          <br />
          satsを送ると雷神と風神が出撃。みんなで協力して8地方を守りぬこう。
        </p>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div>
              <b>QRから参加（無料）</b>
              <span>
                sats（サッツ）はビットコインの小さな単位。会場では配られたsatsでチャージ。体験版は{STARTING_CREDIT} satsを最初から配ります。
              </span>
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div>
              <b>「おすすめで出撃」をタップ（1回 21 sats）</b>
              <span>迷ったらこれだけでOK。自分で地方と技（⚡雷撃・🌀竜巻・🛡結界・💥合体技）を選ぶこともできます。</span>
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div>
              <b>みんなで8回うごくと敵ターン</b>
              <span>時間制限なし。⚠の地方は次の敵ターンでとられる予告。5地方とられたら日本陥落。何ウェーブ守れるか挑戦！</span>
            </div>
          </li>
        </ol>
        <p className="fine">
          会場では大画面にこの戦いが映り、通りがかった人がQRコードからスマホで参加します。この体験版は「大画面」と「あなたのスマホ」を1ページで再現します。
        </p>
      </section>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ nickname: nickname.trim() || 'あなた', crowd });
        }}
      >
        <div className="field">
          <label htmlFor="nick">大画面に出る名前</label>
          <input id="nick" maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="例：さとし" autoComplete="off" />
        </div>
        <div className="field">
          <span className="label">ほかのお客さん（BOT）</span>
          <div className="seg" role="group">
            {[
              { v: 0, label: 'ひとり', sub: 'あなただけ' },
              { v: 3, label: 'ふつう', sub: '3人' },
              { v: 8, label: '大盛況', sub: '8人' },
            ].map((it) => (
              <button key={it.v} type="button" aria-pressed={crowd === it.v} onClick={() => setCrowd(it.v)}>
                {it.label}
                <small>{it.sub}</small>
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="go">
          ⚡🌀 出撃する
        </button>
        <p className="tag">オフライン体験版・実際の支払いは発生しません</p>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface View {
  th: Record<RegionId, RegionThreat>;
  danger: Partial<Record<RegionId, { damageNext: number; willFall: boolean }>>;
  doomed: RegionId[];
  plan: PlannedAction | null;
  turnLeft: number;
  fallen: number;
  comboReady: boolean;
  regions: RegionState[];
}

function view(s: MatchState): View {
  const th = threats(s);
  const danger: View['danger'] = {};
  for (const id of REGION_IDS) if (th[id].damageNext > 0) danger[id] = { damageNext: th[id].damageNext, willFall: th[id].willFall };
  return {
    th,
    danger,
    doomed: REGION_IDS.filter((id) => th[id].willFall),
    plan: s.status === 'LIVE' ? recommendAction(s) : null,
    turnLeft: Math.max(0, s.config.actionsPerTurn - s.actionsThisTurn),
    fallen: REGION_IDS.filter((id) => s.regions[id].fallen).length,
    comboReady: s.combo >= s.config.comboGaugeMax,
    regions: REGION_IDS.map((id) => s.regions[id]),
  };
}

function describePlan(p: PlannedAction, enemies: Enemy[]): string {
  const where = REGION_INFO[p.regionId].labelJa;
  const icon = ACTION_LABELS[p.action].icon;
  const t = p.enemyId !== undefined ? enemies.find((e) => e.id === p.enemyId) : undefined;
  switch (p.action) {
    case 'RAIJIN':
      return `${icon} ${where}の${t ? ENEMY_LABELS[t.kind].ja : '敵'}に雷撃`;
    case 'FUJIN':
      return `${icon} ${where}に竜巻（全員にダメージ）`;
    case 'SHIELD':
      return `${icon} ${where}に結界`;
    case 'COMBO':
      return `${icon} ${where}に合体技！`;
  }
}

function Pips({ filled, total, label }: { filled: number; total: number; label: string }) {
  return (
    <span className="pips" role="meter" aria-label={label} aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  );
}

interface Pop {
  id: number;
  text: string;
  big: boolean;
  mine: boolean;
}
interface Bubble {
  id: number;
  emoji: string;
  nickname: string;
  x: number;
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function Game({ options, onSettings }: { options: SoloOptions; onSettings: () => void }) {
  // Start immediately so the first render already has a running campaign.
  const match = useMemo(() => {
    const m = new LocalMatch(options);
    m.start();
    return m;
  }, [options]);
  const director = useMemo(() => new ArenaDirector(), []);
  const sfx = useMemo(() => new SfxEngine(), []);
  useSyncExternalStore(
    (cb) => match.subscribe(cb),
    () => match.version,
  );
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [sound, setSound] = useState(false);
  const [use3d] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  const ids = useRef(0);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

  useEffect(() => {
    director.settings = { reducedMotion, shakeScale: 0.7, shortSpecials: false };
    const offs = [
      director.onBanner(setBanner),
      director.onSound((name) => sfx.play(name as SfxName)),
      match.onEvent((e) => {
        cueFromEvent(director, e);
        if (e.type === 'MATCH_STATUS_CHANGED' && e.data.to === 'LIVE' && e.data.from === 'CREATED') director.reset();
        if (e.type === 'PLAYER_ACTION') {
          const d = e.data;
          const what = d.liberated ? '奪還！' : d.action === 'SHIELD' ? '結界' : d.kills > 0 ? `撃破×${d.kills}` : `−${d.damage}`;
          const pop: Pop = {
            id: ++ids.current,
            text: `${d.nickname} ${ACTION_LABELS[d.action].icon} ${REGION_INFO[d.regionId].shortJa} ${what}`,
            big: d.liberated || d.kills > 0 || d.action === 'COMBO',
            mine: d.participantId === 'you',
          };
          // Keep at most 7 so a busy crowd never buries the map.
          setPops((p) => [...p.slice(-6), pop]);
          setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 2600);
        }
      }),
      match.onCheer((c) => {
        const b: Bubble = { id: ++ids.current, emoji: c.emoji, nickname: c.nickname, x: Math.random() };
        setBubbles((p) => [...p.slice(-12), b]);
        setTimeout(() => setBubbles((p) => p.filter((x) => x.id !== b.id)), 3000);
        director.play({ kind: 'cheer' });
      }),
    ];
    director.play({ kind: 'campaignStart' });
    director.play({ kind: 'waveStart', wave: match.state.wave, boss: false });
    const id = setInterval(() => match.tick(), 100);
    // Without WebGL nothing drives the director clock, so do it here.
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      if (!use3d || contextLost) director.update((now - prev) / 1000);
      prev = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      offs.forEach((o) => o());
      clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [match, director, sfx, reducedMotion, use3d, contextLost]);

  const toggleSound = async () => {
    if (!sound) {
      const ok = await sfx.unlock();
      sfx.setMuted(false);
      setSound(ok);
    } else {
      sfx.setMuted(true);
      setSound(false);
    }
  };

  const s = match.state;
  const v = view(s);
  const g = v.comboReady ? 1 : 0.15 + 0.5 * (s.combo / s.config.comboGaugeMax);

  return (
    <main className="game">
      <section className="stage" aria-label="会場の大画面">
        {use3d && !contextLost ? (
          <ArenaScene
            director={director}
            regions={v.regions}
            enemies={s.enemies}
            danger={v.danger}
            cityHpMax={s.config.cityHpMax}
            glow={{ RAIJIN: g, FUJIN: g }}
            quality="medium"
            reducedMotion={reducedMotion}
            locale="ja"
            onContextLost={() => setContextLost(true)}
          />
        ) : (
          <div className="flat">
            <FlatMap s={s} v={v} />
          </div>
        )}
        <Hud match={match} v={v} banner={banner} pops={pops} bubbles={bubbles} reducedMotion={reducedMotion} />
      </section>
      <Phone match={match} v={v} sound={sound} onSound={toggleSound} onSettings={onSettings} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Big-screen HUD
// ---------------------------------------------------------------------------

function Hud({
  match,
  v,
  banner,
  pops,
  bubbles,
  reducedMotion,
}: {
  match: LocalMatch;
  v: View;
  banner: Banner | null;
  pops: Pop[];
  bubbles: Bubble[];
  reducedMotion: boolean;
}) {
  const s = match.state;
  const c = s.config;
  const live = s.status === 'LIVE';
  const boss = s.enemies.some((e) => e.kind === 'MOTHERSHIP');
  const landing = [...new Set(s.incoming.map((l) => l.regionId))];
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="gauge">
          <div className="wave">
            ウェーブ <span className="num">{s.wave}</span>
            {boss && <small> 🪐 母艦</small>}
          </div>
          {live && (
            <div className="gauge-sub">
              <span className="ko">
                敵ターンまで あと<b className="num">{v.turnLeft}</b>手
              </span>
              <Pips filled={c.actionsPerTurn - v.turnLeft} total={c.actionsPerTurn} label="敵ターンゲージ" />
            </div>
          )}
          {live && (
            <div className={`gauge-sub ${v.comboReady ? 'ready' : ''}`}>
              💥 {v.comboReady ? '合体技 発動OK！' : `合体ゲージ ${s.combo}/${c.comboGaugeMax}`}
            </div>
          )}
        </div>
        <div className="clock">
          <div className="region">地球防衛軍</div>
          <div className="round">{match.bestWave > 0 ? `最高記録 ウェーブ${match.bestWave}` : `防衛戦 ${match.campaigns}回目`}</div>
        </div>
        <div className="gauge right">
          <div className="gauge-sub">
            👾 とられた {v.fallen}/{c.fallLimit} <Pips filled={v.fallen} total={c.fallLimit} label="とられた地方" />
          </div>
          {live && v.doomed.length > 0 ? (
            <div className="doomed">⚠ {v.doomed.map((id) => REGION_INFO[id].shortJa).join('・')} が次の敵ターンでとられる！</div>
          ) : live ? (
            <div className="gauge-sub">今のところ安全。敵を減らそう！</div>
          ) : null}
          {live && landing.length > 0 && <div className="gauge-sub land">🛸 着陸予告：{landing.map((id) => REGION_INFO[id].shortJa).join('・')}</div>}
        </div>
      </div>
      <div className="pops l" aria-hidden>
        {pops.map((p) => (
          <div key={p.id} className={`pop ${p.big ? 'big' : ''} ${p.mine ? 'mine' : ''}`} style={{ borderColor: '#25C8D7' }}>
            {p.text}
          </div>
        ))}
      </div>
      <div className="cheers" aria-hidden>
        {bubbles.map((b) => (
          <div key={b.id} className={`bubble ${reducedMotion ? '' : 'up'}`} style={{ left: `${b.x < 0.5 ? 4 + b.x * 50 : 66 + (b.x - 0.5) * 50}%` }}>
            <span className="e">{b.emoji}</span>
            <span className="n">{b.nickname}</span>
          </div>
        ))}
      </div>
      <div className="hud-mid">
        {banner && (
          <div key={banner.textJa + banner.until} className="banner" style={{ borderColor: TONE[banner.tone] }}>
            <div className="b1" style={{ color: TONE[banner.tone] }}>
              {banner.textJa}
            </div>
            {banner.subJa && <div className="b2">{banner.subJa}</div>}
          </div>
        )}
      </div>
      <div className="howto">
        <b>① QRを読む ② 「おすすめで出撃」をタップ ③ 名前が画面に出る！</b>
        <span>1回 21 sats ・ 時間制限なし ・ satsはビットコインの小さな単位 ・ 体験版は支払いなし</span>
      </div>
      {s.status === 'PAUSED' && (
        <div className="cover">
          <div className="big">一時停止中</div>
        </div>
      )}
      {s.status === 'FINISHED' && s.result && (
        <div className="result-card">
          <div>ウェーブ{s.result.reachedWave}まで守りぬいた！</div>
          <small>
            撃破 {s.result.stats.kills}体 ・ 奪還 {s.result.stats.regionsLiberated}回 ・ みんなで {s.result.stats.actions}回 出撃 ・ まもなく次の防衛戦
          </small>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2D map (no-WebGL stage and the phone's region picker)
// ---------------------------------------------------------------------------

const B = mapBounds();
const PAD = 0.6;
const PATHS = Object.fromEntries(
  Object.entries(REGION_OUTLINES).map(([id, polys]) => [
    id,
    polys.map((poly) => `M${poly.map((p) => `${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join('L')}Z`).join(' '),
  ]),
) as Record<string, string>;

function fill(r: RegionState, max: number): string {
  if (r.fallen) return '#5B2A86';
  const k = r.cityHp / max;
  return k > 0.6 ? '#2F7FD8' : k > 0.3 ? '#E0A030' : '#D8483A';
}

function FlatMap({ s, v, selected = null, onSelect }: { s: MatchState; v: View; selected?: RegionId | null; onSelect?: (id: RegionId) => void }) {
  return (
    <svg viewBox={`${B.minX - PAD} ${-B.maxY - PAD} ${B.maxX - B.minX + PAD * 2} ${B.maxY - B.minY + PAD * 2}`} role="group" aria-label="日本地図">
      <defs>
        <pattern id="solo-hatch" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.5" stroke="#C98BFF" strokeWidth="0.14" />
        </pattern>
      </defs>
      {REGION_IDS.map((id) => {
        const r = s.regions[id];
        const sel = selected === id;
        const doomed = !!v.danger[id]?.willFall;
        return (
          <g
            key={id}
            onClick={onSelect ? () => onSelect(id) : undefined}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${REGION_INFO[id].labelJa}${r.fallen ? '（とられた）' : ''}`}
            aria-pressed={onSelect ? sel : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(id);
                    }
                  }
                : undefined
            }
            style={onSelect ? { cursor: 'pointer' } : undefined}
          >
            <path
              d={PATHS[id]}
              fill={fill(r, s.config.cityHpMax)}
              fillOpacity={0.88}
              stroke={sel ? '#fff' : doomed ? '#FF5A4A' : '#0B1222'}
              strokeWidth={sel ? 0.24 : doomed ? 0.18 : 0.06}
            />
            {r.fallen && <path d={PATHS[id]} fill="url(#solo-hatch)" pointerEvents="none" />}
          </g>
        );
      })}
      {REGION_IDS.map((id) => {
        const c = REGION_CENTROIDS[id];
        const r = s.regions[id];
        const n = s.enemies.filter((e) => e.regionId === id).length;
        return (
          <g key={`t-${id}`} transform={`translate(${c.x},${-c.y})`} pointerEvents="none">
            <text textAnchor="middle" fontSize={0.55} fontWeight={800} fill={selected === id ? '#FFE27A' : '#fff'} stroke="#070D1A" strokeWidth={0.1} paintOrder="stroke">
              {v.danger[id]?.willFall ? '⚠ ' : ''}
              {REGION_INFO[id].shortJa}
            </text>
            <text y={0.6} textAnchor="middle" fontSize={0.44} fontWeight={800} fill="#fff" stroke="#070D1A" strokeWidth={0.08} paintOrder="stroke">
              {r.fallen ? `👾${n}` : `🏙${r.cityHp}${r.shield > 0 ? ' 🛡' : ''}${n > 0 ? ` 🛸${n}` : ''}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// "Your phone" panel
// ---------------------------------------------------------------------------

function errorText(r: ActionResult | undefined): string {
  if (!r) return '';
  const lab = ACTION_ERROR_LABELS[r.code as keyof typeof ACTION_ERROR_LABELS];
  return lab ? lab.ja : r.code;
}

function Phone({ match, v, sound, onSound, onSettings }: { match: LocalMatch; v: View; sound: boolean; onSound: () => void; onSettings: () => void }) {
  const s = match.state;
  const c = s.config;
  const [flash, setFlash] = useState<{ id: number; text: string; tone: string } | null>(null);
  const [cheerCd, setCheerCd] = useState(false);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const fid = useRef(0);
  const credit = match.creditSats;
  const live = s.status === 'LIVE';
  const canAct = live && credit >= c.actionCostSats;

  useEffect(() => {
    if (target !== null && !s.enemies.some((e) => e.id === target)) setTarget(null);
  }, [s.enemies, target]);

  const show = (text: string, tone: string) => {
    const id = ++fid.current;
    setFlash({ id, text, tone });
    setTimeout(() => setFlash((f) => (f?.id === id ? null : f)), 1700);
  };

  const act = (action: PlayerAction, regionId?: RegionId, enemyId?: number) => {
    const r = match.act(action, regionId, enemyId);
    if (!r.ok) {
      if (r.reason === 'NO_CREDIT') show('satsが足りません。下でチャージしてね', 'warn');
      else if (r.reason === 'REFUSED') show(errorText(r.result), 'info');
      return;
    }
    try {
      navigator.vibrate?.(12);
    } catch {
      // unsupported
    }
    const res = r.result;
    const where = res.regionId ? REGION_INFO[res.regionId].labelJa : '';
    const icon = res.action ? ACTION_LABELS[res.action].icon : '';
    if (res.liberated) show(`${where} 奪還！ あなたのおかげ！`, 'special');
    else if (res.action === 'COMBO') show(`💥 合体技！ ${res.kills}体撃破`, 'special');
    else if (res.action === 'SHIELD') show(`🛡 ${where}に結界！`, 'hit');
    else if (res.kills > 0) show(`${icon} 撃破！ ×${res.kills}`, 'special');
    else show(`${icon} 命中！ −${res.damage}`, 'hit');
    if (res.triggeredAlienTurn) setTimeout(() => show('👾 あなたの一手で敵ターン！', 'ko'), 1200);
  };

  // Space / Enter = おすすめ on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        act('AUTO');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let label = 'おすすめで出撃！';
  let sub = v.plan ? describePlan(v.plan, s.enemies) : 'いちばん役立つ一手';
  let disabled = false;
  if (s.status === 'PAUSED') {
    label = '一時停止中';
    sub = '';
    disabled = true;
  } else if (!live) {
    label = '次の防衛戦まで少し待ってね';
    sub = s.result ? `ウェーブ${s.result.reachedWave}まで守った！` : '';
    disabled = true;
  } else if (credit < c.actionCostSats) {
    label = 'チャージして出撃！';
    sub = '下のボタンでsatsを追加';
  }

  const sel = selected ? s.regions[selected] : null;
  const selEnemies = selected ? s.enemies.filter((e) => e.regionId === selected) : [];
  const selTh = selected ? v.th[selected] : null;
  const move = (action: Exclude<PlayerAction, 'AUTO'>, enabled: boolean, hint?: string) => (
    <button
      key={action}
      type="button"
      className="move"
      disabled={!enabled}
      onClick={() => act(action, selected ?? undefined, action === 'RAIJIN' ? (target ?? undefined) : undefined)}
    >
      <b>
        {ACTION_LABELS[action].icon} {ACTION_LABELS[action].ja}
      </b>
      <small>{hint ?? ACTION_LABELS[action].hintJa}</small>
    </button>
  );

  return (
    <aside className="phone" aria-label="あなたのスマホ">
      <div className="phone-head">
        <span className="pill">📱 あなたのスマホ</span>
        <span className="team">🛡 地球防衛軍</span>
        <span className="who">{match.options.nickname}</span>
      </div>

      <div className="status">
        <div className="row">
          <b>ウェーブ {s.wave}</b>
          <span>
            👾 とられた {v.fallen}/{c.fallLimit}
          </span>
        </div>
        {live && (
          <div className="row">
            <span>
              敵ターンまで あと<b className="num big">{v.turnLeft}</b>手
            </span>
            <span className={v.comboReady ? 'ready' : ''}>💥 {v.comboReady ? '合体OK！' : `${s.combo}/${c.comboGaugeMax}`}</span>
          </div>
        )}
        {live && v.doomed.length > 0 && <div className="pinch-note">⚠ {v.doomed.map((id) => REGION_INFO[id].labelJa).join('・')}があぶない！ 次の敵ターンでとられる</div>}
      </div>

      <div className="punch-wrap">
        <button type="button" className="punch auto" onClick={() => act('AUTO')} disabled={disabled}>
          <span className="sym" aria-hidden>
            ⚡🌀
          </span>
          <span className="lbl">{label}</span>
          <span className="sub">{sub}</span>
          {canAct && <span className="sub">1回 {c.actionCostSats} sats</span>}
        </button>
        {flash && (
          <div key={flash.id} className={`flash ${flash.tone}`} role="status">
            {flash.text}
          </div>
        )}
      </div>

      <div className="manual">
        <small>自分で選ぶ：地方をタップ</small>
        <div className="mini-map">
          <FlatMap
            s={s}
            v={v}
            selected={selected}
            onSelect={(id) => {
              setSelected(id === selected ? null : id);
              setTarget(null);
            }}
          />
        </div>
        {sel && selTh && (
          <div className="region-panel">
            <div className="row">
              <b>{REGION_INFO[sel.regionId].labelJa}</b>
              <span>
                {sel.fallen ? (
                  <em className="captured">👾 とられた！ 敵を全部倒すと奪還</em>
                ) : (
                  <>
                    🏙 {sel.cityHp}/{c.cityHpMax}
                    {sel.shield > 0 && ` ・ 🛡${sel.shield}`}
                    {selTh.damageNext > 0 && <em className={selTh.willFall ? 'bad' : 'warn'}> ・ 次 −{selTh.damageNext}</em>}
                  </>
                )}
              </span>
            </div>
            {selEnemies.length > 0 ? (
              <div className="targets" role="group" aria-label="ねらう敵">
                {selEnemies.map((e) => (
                  <button key={e.id} type="button" aria-pressed={target === e.id} onClick={() => setTarget(target === e.id ? null : e.id)}>
                    {ENEMY_LABELS[e.kind].icon} {ENEMY_LABELS[e.kind].ja} ❤{e.hp} ⚔{e.attack}
                  </button>
                ))}
              </div>
            ) : (
              <small>{selTh.landing > 0 ? `🛸 次の敵ターンに ${selTh.landing}体 降りてくる予告` : 'ここに敵はいません'}</small>
            )}
            <div className="moves">
              {move('RAIJIN', canAct && selEnemies.length > 0, target !== null ? '選んだ敵に大ダメージ' : undefined)}
              {move('FUJIN', canAct && selEnemies.length > 0)}
              {move('SHIELD', canAct && !sel.fallen && sel.shield === 0, sel.shield > 0 ? 'もう結界があります' : undefined)}
              {move('COMBO', canAct && v.comboReady && selEnemies.length > 0, v.comboReady ? undefined : `ゲージ ${s.combo}/${c.comboGaugeMax}`)}
            </div>
          </div>
        )}
      </div>

      <div className="credit">
        <div>
          <small>残高（体験版のsats）</small>
          <b className="num">
            {credit} <span>sats = あと{actionsFor(credit, c)}回</span>
          </b>
          <small>
            あなた：{match.myActions}回出撃 ・ 撃破 {match.myKills}体
          </small>
        </div>
        <div className="topups">
          {c.topupOptionsSats.slice(0, 2).map((amt) => (
            <button key={amt} type="button" onClick={() => match.topup(amt)}>
              +{amt}
              <small>{actionsFor(amt, c)}回</small>
            </button>
          ))}
        </div>
      </div>
      <p className="note">会場ではここでLightningの請求書を1回払うだけ。あとは出撃するたびに残高から21 satsずつ使います（うまくいかなかった一手は無料）。</p>

      <div className="cheer">
        <small>無料で応援（大画面に出ます・satsは使いません）</small>
        <div className="emojis">
          {CHEER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              disabled={cheerCd}
              onClick={() => {
                match.cheer(e);
                setCheerCd(true);
                setTimeout(() => setCheerCd(false), c.cheerCooldownMs);
              }}
              aria-label={`${e} で応援`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="tools">
        <button type="button" onClick={() => match.setCrowd(match.crowd === 0 ? 3 : match.crowd >= 8 ? 0 : 8)}>
          👥 BOT {match.crowd}人
        </button>
        <button type="button" onClick={() => (s.status === 'PAUSED' ? match.resume() : match.pause())}>
          {s.status === 'PAUSED' ? '▶ 再開' : '⏸ 一時停止'}
        </button>
        <button type="button" onClick={onSound}>
          {sound ? '🔊 音ON' : '🔇 音OFF'}
        </button>
        <button type="button" onClick={onSettings}>
          ⚙ 最初から
        </button>
      </div>
      <p className="fine">
        体験版：BOTはほかのお客さんの代わりに「おすすめ」を押します（BOT 0人なら、あなたが動くまでゲームは止まったまま）。スペースキーでもおすすめ出撃。賞金・換金はありません。
      </p>
    </aside>
  );
}
