import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RoundState, TeamId } from '@sats-wars/shared';
import {
  CHEER_EMOJIS,
  REGION_CENTROIDS,
  REGION_INFO,
  REGION_OUTLINES,
  TEAM_META,
  mapBounds,
  otherTeam,
  zapsFor,
} from '@sats-wars/shared';
import { punchesToKo, punchesToSpecial } from '@sats-wars/game-engine';
import { ArenaDirector, ArenaScene, type Banner, SfxEngine, type SfxName, cueFromEvent } from '@sats-wars/three-game';
import { LocalMatch, STARTING_CREDIT, type SoloOptions } from './localMatch';

const NEUTRAL = '#41506E';
const color = (t: TeamId | null) => (t ? TEAM_META[t].color : NEUTRAL);

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
  const [crowd, setCrowd] = useState(5);
  const go = (team: TeamId) => onStart({ nickname: nickname.trim() || 'あなた', team, crowd });
  return (
    <main className="setup">
      <section>
        <h1 className="title">
          <span className="r">SATS</span> <span className="f">WARS</span>
        </h1>
        <div className="versus">
          <span className="raijin">雷神</span> VS <span className="fujin">風神</span>
        </div>
        <p className="oneline">
          応援するロボットを選んで、satsを送るとパンチ！
          <br />
          先にHPを0にしたチームがその地方をゲット。
        </p>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div>
              <b>ロボットを選ぶ（無料）</b>
              <span>雷神と風神の性能はまったく同じ。違うのは見た目と演出だけ。</span>
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div>
              <b>satsをチャージ</b>
              <span>
                sats（サッツ）はビットコインの小さな単位。会場では配られたsatsで1回だけチャージ。体験版は{STARTING_CREDIT}{' '}
                satsを最初から配ります。
              </span>
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div>
              <b>タップでパンチ！（1発 21 sats）</b>
              <span>チーム10発ごとに必殺技。HPが30%を切るとパンチ1.5倍で逆転のチャンス。8地方を取り合って全国制覇！</span>
            </div>
          </li>
        </ol>
        <p className="fine">
          会場では大画面にこのバトルが映り、通りがかった人がQRコードからスマホで参加します。この体験版は「大画面」と「あなたのスマホ」を1ページで再現し、まわりの観客はBOTが務めます。
        </p>
      </section>

      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="nick">大画面に出る名前</label>
          <input id="nick" maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="例：さとし" autoComplete="off" />
        </div>
        <div className="field">
          <span className="label">会場のにぎわい（各チームのBOT観客）</span>
          <div className="seg" role="group">
            {[
              { v: 2, label: 'まばら', sub: '2人' },
              { v: 5, label: 'ふつう', sub: '5人' },
              { v: 12, label: '大盛況', sub: '12人' },
            ].map((it) => (
              <button key={it.v} type="button" aria-pressed={crowd === it.v} onClick={() => setCrowd(it.v)}>
                {it.label}
                <small>{it.sub}</small>
              </button>
            ))}
          </div>
        </div>
        <span className="label">どっちを応援する？</span>
        <div className="pick">
          {(['RAIJIN', 'FUJIN'] as const).map((t) => (
            <button key={t} type="button" className={`pick-btn ${t === 'RAIJIN' ? 'r' : 'f'}`} onClick={() => go(t)}>
              <span className="sym" aria-hidden>
                {TEAM_META[t].symbol}
              </span>
              <span className="nm">{TEAM_META[t].nameJa}</span>
              <small>{TEAM_META[t].nameEn}</small>
            </button>
          ))}
        </div>
        <p className="tag">オフライン体験版・実際の支払いは発生しません</p>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

interface Pop {
  id: number;
  teamId: TeamId;
  text: string;
  big: boolean;
  mine: boolean;
}
interface Bubble {
  id: number;
  teamId: TeamId;
  emoji: string;
  nickname: string;
  x: number;
}

function Game({ options, onSettings }: { options: SoloOptions; onSettings: () => void }) {
  // Start immediately so the first render already has a running season.
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
  useTicker(250);
  const [hp, setHp] = useState<Record<TeamId, number>>({ RAIJIN: 200, FUJIN: 200 });
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
    director.syncHp({ RAIJIN: 200, FUJIN: 200 }, 200);
    const offs = [
      director.onHp((h) => setHp({ ...h })),
      director.onBanner(setBanner),
      director.onSound((name) => sfx.play(name as SfxName)),
      match.onEvent((e) => {
        cueFromEvent(director, e, match.state.config.roundsPerSeason);
        if (e.type === 'ZAP') {
          const d = e.data;
          const sym = TEAM_META[d.teamId].symbol;
          const text = d.code === 'KO' ? `${d.nickname} ${sym} KO!!` : d.special ? `${d.nickname} ${sym} 必殺 −${d.damage}` : `${d.nickname} ${sym} −${d.damage}`;
          const pop: Pop = { id: ++ids.current, teamId: d.teamId, text, big: d.special || d.code === 'KO', mine: d.participantId === 'you' };
          // Keep at most 6 per side so a busy crowd never buries the robots.
          setPops((p) => {
            const side = p.filter((x) => x.teamId === d.teamId);
            const drop = side.length >= 6 ? side[0]!.id : null;
            return [...p.filter((x) => x.id !== drop), pop];
          });
          setTimeout(() => setPops((p) => p.filter((x) => x.id !== pop.id)), 2200);
        }
      }),
      match.onCheer((c) => {
        const b: Bubble = { id: ++ids.current, teamId: c.teamId, emoji: c.emoji, nickname: c.nickname, x: Math.random() };
        setBubbles((p) => [...p.slice(-12), b]);
        setTimeout(() => setBubbles((p) => p.filter((x) => x.id !== b.id)), 3000);
        director.play({ kind: 'cheer', teamId: c.teamId });
      }),
    ];
    director.play({ kind: 'seasonStart' });
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

  // Keep the HUD on the authoritative numbers if a cue was missed.
  const s = match.state;
  useEffect(() => {
    const r = s.round;
    if (r && !director.busy && (director.hpMax !== r.hpMax || hp.RAIJIN !== r.hp.RAIJIN || hp.FUJIN !== r.hp.FUJIN)) {
      director.syncHp(r.hp, r.hpMax);
    }
  });

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

  const regions = s.roundOrder.map((id) => s.regions[id]);
  const focus = s.status === 'LIVE' && s.phase === 'ROUND' ? (s.round?.regionId ?? null) : null;
  const pinchHp = (s.round?.hpMax ?? 0) * s.config.pinchHpRatio;
  const glow: Record<TeamId, number> = {
    RAIJIN: s.round && hp.RAIJIN > 0 && hp.RAIJIN <= pinchHp ? 1 : 0.15,
    FUJIN: s.round && hp.FUJIN > 0 && hp.FUJIN <= pinchHp ? 1 : 0.15,
  };

  return (
    <main className="game">
      <section className="stage" aria-label="会場の大画面">
        {use3d && !contextLost ? (
          <ArenaScene
            director={director}
            regions={regions}
            focusRegionId={focus}
            glow={glow}
            quality="medium"
            reducedMotion={reducedMotion}
            locale="ja"
            onContextLost={() => setContextLost(true)}
          />
        ) : (
          <FlatStage match={match} focus={focus} />
        )}
        <Hud match={match} hp={hp} banner={banner} pops={pops} bubbles={bubbles} reducedMotion={reducedMotion} />
      </section>
      <Phone match={match} sound={sound} onSound={toggleSound} onSettings={onSettings} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Big-screen HUD
// ---------------------------------------------------------------------------

function roundInfo(match: LocalMatch) {
  const s = match.state;
  const c = s.config;
  const r: Pick<RoundState, 'hp' | 'hpMax' | 'gauge'> = s.round ?? {
    hp: { RAIJIN: c.hpInitial, FUJIN: c.hpInitial },
    hpMax: c.hpInitial,
    gauge: { RAIJIN: 0, FUJIN: 0 },
  };
  const fighting = s.status === 'LIVE' && s.phase === 'ROUND';
  const regionId = s.round?.regionId ?? s.roundOrder[s.roundIndex]!;
  return {
    fighting,
    regionId,
    roundNo: (s.round?.index ?? s.roundIndex) + 1,
    hpMax: r.hpMax,
    toKo: { RAIJIN: punchesToKo(c, r, 'RAIJIN'), FUJIN: punchesToKo(c, r, 'FUJIN') },
    toSpecial: { RAIJIN: punchesToSpecial(c, r.gauge.RAIJIN), FUJIN: punchesToSpecial(c, r.gauge.FUJIN) },
    pinch: {
      RAIJIN: !!s.round && r.hp.RAIJIN > 0 && r.hp.RAIJIN <= r.hpMax * c.pinchHpRatio,
      FUJIN: !!s.round && r.hp.FUJIN > 0 && r.hp.FUJIN <= r.hpMax * c.pinchHpRatio,
    },
    next: s.roundOrder[s.phase === 'OPENING' ? 0 : s.roundIndex + 1] ?? null,
  };
}

function Gauge({ match, teamId, hp, side }: { match: LocalMatch; teamId: TeamId; hp: number; side: 'left' | 'right' }) {
  const info = roundInfo(match);
  const m = TEAM_META[teamId];
  const foe = TEAM_META[otherTeam(teamId)];
  return (
    <div className={`gauge ${side}`}>
      <div className="gauge-head">
        <div className="gauge-name" style={{ color: m.color }}>
          {m.symbol}
          {m.nameJa}
          <small>{m.nameEn}</small>
        </div>
        <div className="gauge-hp num">
          {hp}
          <small>/{info.hpMax}</small>
        </div>
      </div>
      <div className="bar" role="meter" aria-label={`${m.nameJa} HP`} aria-valuenow={hp} aria-valuemin={0} aria-valuemax={info.hpMax}>
        <i style={{ width: `${(hp / info.hpMax) * 100}%`, background: `linear-gradient(90deg, ${m.colorDark}, ${m.color}, ${m.colorLight})` }} />
        {info.pinch[teamId] && <span className="pinch">ピンチ！ パンチ1.5倍</span>}
      </div>
      <div className="gauge-sub">
        {info.fighting && (
          <span className="ko">
            {foe.nameJa}KOまで あと<b className="num">{info.toKo[teamId]}</b>発
          </span>
        )}
        {info.fighting && <span className="sp">必殺技まで{info.toSpecial[teamId]}発</span>}
        <span className="won">{match.state.teams[teamId].regionsWon}地方</span>
      </div>
    </div>
  );
}

function Hud({
  match,
  hp,
  banner,
  pops,
  bubbles,
  reducedMotion,
}: {
  match: LocalMatch;
  hp: Record<TeamId, number>;
  banner: Banner | null;
  pops: Pop[];
  bubbles: Bubble[];
  reducedMotion: boolean;
}) {
  const s = match.state;
  const info = roundInfo(match);
  const left = match.secondsLeft();
  const showHp = (t: TeamId) => (s.round ? hp[t] : info.hpMax);
  return (
    <div className="hud">
      <div className="hud-top">
        <Gauge match={match} teamId="RAIJIN" hp={showHp('RAIJIN')} side="left" />
        <div className="clock">
          <div className="round">
            第{info.roundNo}戦 <small>/ {s.config.roundsPerSeason}</small>
          </div>
          <div className="region">⚔ {REGION_INFO[info.regionId].labelJa}</div>
          <div className="secs num">{info.fighting && left !== null ? left : '—'}</div>
        </div>
        <Gauge match={match} teamId="FUJIN" hp={showHp('FUJIN')} side="right" />
      </div>
      <div className="strip">
        {s.roundOrder.map((id, i) => {
          const owner = s.regions[id].ownerTeamId;
          const current = i === s.roundIndex && (s.phase === 'ROUND' || s.phase === 'ROUND_END');
          return (
            <span key={id} className={`chip ${current ? 'cur' : ''}`} style={{ background: owner ? color(owner) : undefined, color: owner ? '#070D1A' : undefined }}>
              {owner ? TEAM_META[owner].symbol : current ? '⚔' : i + 1} {REGION_INFO[id].shortJa}
            </span>
          );
        })}
      </div>
      {(['RAIJIN', 'FUJIN'] as const).map((t) => (
        <div key={t} className={`pops ${t === 'RAIJIN' ? 'l' : 'r'}`} aria-hidden>
          {pops
            .filter((p) => p.teamId === t)
            .map((p) => (
              <div key={p.id} className={`pop ${p.big ? 'big' : ''} ${p.mine ? 'mine' : ''}`} style={{ borderColor: TEAM_META[t].color }}>
                {p.text}
              </div>
            ))}
        </div>
      ))}
      <div className="cheers" aria-hidden>
        {bubbles.map((b) => (
          <div key={b.id} className={`bubble ${reducedMotion ? '' : 'up'}`} style={{ left: `${b.teamId === 'RAIJIN' ? 4 + b.x * 30 : 66 + b.x * 30}%` }}>
            <span className="e">{b.emoji}</span>
            <span className="n" style={{ color: TEAM_META[b.teamId].color }}>
              {b.nickname}
            </span>
          </div>
        ))}
      </div>
      <div className="hud-mid">
        {banner ? (
          <div key={banner.textJa + banner.until} className="banner" style={{ borderColor: banner.teamId ? color(banner.teamId) : '#EFF5FF' }}>
            <div className="b1" style={{ color: banner.teamId ? color(banner.teamId) : '#EFF5FF' }}>
              {banner.textJa}
            </div>
            {banner.subJa && <div className="b2">{banner.subJa}</div>}
          </div>
        ) : s.status === 'LIVE' && (s.phase === 'ROUND_END' || s.phase === 'OPENING') && info.next ? (
          <div className="banner next">
            <div className="b2">次の戦い：{REGION_INFO[info.next].labelJa}</div>
            <div className="b1 num">{left ?? ''}</div>
          </div>
        ) : null}
      </div>
      <div className="howto">
        <b>① QRを読む ② ロボットを選ぶ ③ タップでパンチ！</b>
        <span>1発 21 sats ・ satsはビットコインの小さな単位 ・ 体験版は支払いなし</span>
      </div>
      {s.status === 'PAUSED' && (
        <div className="cover">
          <div className="big">一時停止中</div>
        </div>
      )}
      {(s.phase === 'SEASON_END' || s.status === 'FINISHED') && s.result && (
        <div className="result-card">
          <div>
            雷神 {s.result.regionCounts.RAIJIN} – {s.result.regionCounts.FUJIN} 風神
          </div>
          <small>まもなく次のシーズン！ 残高はそのまま使えます</small>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Your phone" panel
// ---------------------------------------------------------------------------

function Phone({ match, sound, onSound, onSettings }: { match: LocalMatch; sound: boolean; onSound: () => void; onSettings: () => void }) {
  const s = match.state;
  const c = s.config;
  const info = roundInfo(match);
  const my = match.team;
  const foe = otherTeam(my);
  const m = TEAM_META[my];
  const [flash, setFlash] = useState<{ id: number; text: string; tone: string } | null>(null);
  const [pressed, setPressed] = useState(0);
  const [cheerCd, setCheerCd] = useState(false);
  const fid = useRef(0);
  const left = match.secondsLeft();
  const credit = match.creditSats;

  const show = (text: string, tone: string) => {
    const id = ++fid.current;
    setFlash({ id, text, tone });
    setTimeout(() => setFlash((f) => (f?.id === id ? null : f)), 1500);
  };

  const punch = () => {
    const r = match.punch();
    if (!r.ok) {
      if (r.reason === 'NO_CREDIT') show('satsが足りません。下でチャージしてね', 'warn');
      else if (r.reason === 'NOT_FIGHTING') show('ラウンドの合間です（satsは使われていません）', 'info');
      return;
    }
    setPressed((n) => n + 1);
    try {
      navigator.vibrate?.(12);
    } catch {
      // unsupported
    }
    const res = r.result;
    if (res.code === 'KO') show('KO!! あなたのとどめ！', 'ko');
    else if (res.special) show(`必殺技！ ${m.specialJa} −${res.damage}`, 'special');
    else show(`命中！ −${res.damage}${res.pinch ? '（1.5倍）' : ''}`, 'hit');
  };

  // Space / Enter = punch on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        punch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let label = 'パンチ！';
  let sub = `1発 ${c.zapCostSats} sats ・ 残り${zapsFor(credit, c)}発`;
  let disabled = false;
  if (s.status === 'PAUSED') {
    label = '一時停止中';
    sub = '';
    disabled = true;
  } else if (s.status !== 'LIVE' || s.phase === 'SEASON_END') {
    label = '次のシーズンまで少し待ってね';
    sub = s.result?.winnerTeamId ? `${TEAM_META[s.result.winnerTeamId].nameJa}が全国制覇！` : '';
    disabled = true;
  } else if (s.phase !== 'ROUND') {
    label = `まもなく次の戦い ${left ?? ''}`;
    sub = info.next ? `次は ${REGION_INFO[info.next].labelJa}` : '';
    disabled = true;
  } else if (credit < c.zapCostSats) {
    label = 'チャージしてパンチ！';
    sub = '下のボタンでsatsを追加';
  }

  return (
    <aside className="phone" aria-label="あなたのスマホ">
      <div className="phone-head">
        <span className="pill">📱 あなたのスマホ</span>
        <span className="team" style={{ color: m.color, borderColor: m.color }}>
          {m.symbol} {m.nameJa}
        </span>
        <span className="who">{match.options.nickname}</span>
      </div>

      <div className="status">
        <div className="row">
          <b>
            第{info.roundNo}戦 ⚔ {REGION_INFO[info.regionId].labelJa}
          </b>
          <span className="num">{info.fighting && left !== null ? `${left}s` : '—'}</span>
        </div>
        {info.fighting && (
          <div className="twin">
            <div>
              <small>チームで{TEAM_META[foe].nameJa}KOまで</small>
              <b>
                あと<em className="num">{info.toKo[my]}</em>発
              </b>
            </div>
            <div className="sp">
              <small>チームの必殺技まで</small>
              <b>
                あと<em className="num">{info.toSpecial[my]}</em>発
              </b>
            </div>
          </div>
        )}
        {info.pinch[my] && info.fighting && <div className="pinch-note">ピンチ！ 今ならパンチ1.5倍で逆転のチャンス</div>}
      </div>

      <div className="punch-wrap">
        <button
          type="button"
          className="punch"
          onClick={punch}
          disabled={disabled}
          style={{
            background: `radial-gradient(circle at 35% 30%, ${m.colorLight}, ${m.color} 45%, ${m.colorDark})`,
            boxShadow: `0 8px 0 ${m.colorDark}, 0 0 36px ${m.color}66`,
          }}
        >
          <span key={pressed} className="sym" aria-hidden>
            {m.symbol}
          </span>
          <span className="lbl">{label}</span>
          <span className="sub">{sub}</span>
        </button>
        {flash && (
          <div key={flash.id} className={`flash ${flash.tone}`} role="status">
            {flash.text}
          </div>
        )}
      </div>

      <div className="credit">
        <div>
          <small>残高（体験版のsats）</small>
          <b className="num">
            {credit} <span>sats = {zapsFor(credit, c)}発</span>
          </b>
          <small>
            今シーズン {match.myPunches}発 ・ KO {match.myKos}回
          </small>
        </div>
        <div className="topups">
          {c.topupOptionsSats.slice(0, 2).map((amt) => (
            <button key={amt} type="button" onClick={() => match.topup(amt)}>
              +{amt}
              <small>{zapsFor(amt, c)}発</small>
            </button>
          ))}
        </div>
      </div>
      <p className="note">会場ではここでLightningの請求書を1回払うだけ。あとはタップするたびに残高から21 satsずつ使います。</p>

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
        <button type="button" onClick={() => match.switchTeam()}>
          ⇄ {TEAM_META[foe].nameJa}に変更
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
      <p className="fine">体験版：BOT観客がパンチしています。スペースキーでもパンチできます。賞金・換金はありません。</p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// No-WebGL fallback
// ---------------------------------------------------------------------------

const B = mapBounds();
const PAD = 0.6;
const PATHS = Object.fromEntries(
  Object.entries(REGION_OUTLINES).map(([id, polys]) => [
    id,
    polys.map((poly) => `M${poly.map((p) => `${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join('L')}Z`).join(' '),
  ]),
) as Record<string, string>;

function FlatStage({ match, focus }: { match: LocalMatch; focus: string | null }) {
  const s = match.state;
  return (
    <div className="flat">
      <svg viewBox={`${B.minX - PAD} ${-B.maxY - PAD} ${B.maxX - B.minX + PAD * 2} ${B.maxY - B.minY + PAD * 2}`} role="img" aria-label="日本地図">
        {s.roundOrder.map((id) => (
          <path
            key={id}
            d={PATHS[id]}
            fill={color(s.regions[id].ownerTeamId)}
            fillOpacity={s.regions[id].ownerTeamId ? 0.85 : 0.5}
            stroke={focus === id ? '#FFE27A' : '#0B1222'}
            strokeWidth={focus === id ? 0.2 : 0.06}
          />
        ))}
        {s.roundOrder.map((id) => {
          const c = REGION_CENTROIDS[id];
          return (
            <text key={`t-${id}`} x={c.x} y={-c.y} textAnchor="middle" fontSize={0.55} fontWeight={800} fill="#fff" stroke="#070D1A" strokeWidth={0.1} paintOrder="stroke">
              {focus === id ? '⚔ ' : ''}
              {REGION_INFO[id].shortJa}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
