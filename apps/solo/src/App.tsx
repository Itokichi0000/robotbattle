import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Role } from '@sats-wars/shared';
import { CHEER_EMOJIS, ONE_LINE_RULES, ROLE_LABELS } from '@sats-wars/shared';
import {
  ArenaDirector,
  ArenaScene,
  type Banner,
  type BannerTone,
  SfxEngine,
  type SfxName,
  cueFromEvent,
} from '@sats-wars/three-game';
import {
  Cockpit,
  JapanMapMini,
  RaidHeader,
  ResultCard,
  RobotBars,
  type SeatState,
  ThreatLine,
  TrainingPanel,
  effectSentence,
  raidView,
} from '@sats-wars/ui';
import { LocalRaid, PLAYER_ID, type SoloOptions } from './localRaid';

const TONE: Record<BannerTone, string> = {
  ally: '#FFE27A',
  enemy: '#FF3B5C',
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
  const [callsign, setCallsign] = useState('');
  const [crew, setCrew] = useState(5);
  return (
    <main className="setup">
      <div className="hero">
        <h1 className="title">
          <span className="r">SATS</span> <span className="f">WARS</span>
        </h1>
        <div className="sub">
          EARTH DEFENSE <span className="raijin">雷神</span>×<span className="fujin">風神</span>
        </div>
        <p className="oneline">{ONE_LINE_RULES.ja}</p>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <span>
              <b>席を選ぶ</b>
              🎯砲撃・🛡防衛・🔌電力・🔧整備。いま必要な席は画面が教えてくれます。
            </span>
          </li>
          <li>
            <span className="n">2</span>
            <span>
              <b>出撃！</b>
              ボタンを押すと数秒のミニゲーム。うまくいくと雷神・風神が動きます。
            </span>
          </li>
          <li>
            <span className="n">3</span>
            <span>
              <b>8分間 守りぬく</b>
              ⚠の予告を見て街を守り、NULL CORE を倒そう。最後は3つの席がそろうと合体技「神雷風陣」！
            </span>
          </li>
        </ol>
        <p className="fine">
          オフライン体験版：会場では大画面とスマホに分かれます。支払いは発生しません（会場では1作戦
          21 sats の出撃パス、または無料イベント）。
        </p>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ callsign: callsign.trim() || 'あなた', crew, botSkill: 0.65, speed: 1 });
        }}
      >
        <label className="field">
          <span className="label">コールサイン（任意）</span>
          <input
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            maxLength={20}
            placeholder="例：サトシ"
          />
        </label>
        <div className="field">
          <span className="label">いっしょに乗る仲間（デモBOT）</span>
          <div className="seg" role="group" aria-label="仲間の数">
            {[0, 3, 5, 8, 12].map((n) => (
              <button
                key={n}
                type="button"
                className={crew === n ? 'on' : ''}
                aria-pressed={crew === n}
                onClick={() => setCrew(n)}
              >
                {n === 0 ? 'ひとり' : `${n}人`}
              </button>
            ))}
          </div>
          <span className="hint">
            少人数のときは補佐AIが空いた席を手伝います（記録は「AI支援あり」）。
          </span>
        </div>
        <button type="submit" className="go" data-testid="solo-start">
          搭乗する
        </button>
        <p className="tag">オフライン体験版・実際の支払いは発生しません</p>
      </form>
    </main>
  );
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Pop {
  id: number;
  text: string;
  tone: 'good' | 'miss' | 'big' | 'mine' | 'cheer';
}

// ---------------------------------------------------------------------------
// Game: big screen + phone side by side
// ---------------------------------------------------------------------------

function Game({ options, onSettings }: { options: SoloOptions; onSettings: () => void }) {
  const raid = useMemo(() => new LocalRaid(options), [options]);
  const director = useMemo(() => new ArenaDirector(), []);
  const sfx = useMemo(() => new SfxEngine(), []);
  useSyncExternalStore(
    (cb) => raid.subscribe(cb),
    () => raid.version,
  );
  // The clock also ticks between events.
  const [, setTick] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [sound, setSound] = useState(false);
  const [use3d] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  const [seatPatch, setSeatPatch] = useState<Partial<SeatState>>({});
  const ids = useRef(0);
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  useEffect(() => {
    director.settings = { reducedMotion, shakeScale: 0.7, shortSpecials: false };
    director.timeScale = 1;
    const pop = (text: string, tone: Pop['tone']) => {
      const p: Pop = { id: ++ids.current, text, tone };
      setPops((xs) => [...xs.slice(-6), p]);
      setTimeout(() => setPops((xs) => xs.filter((x) => x.id !== p.id)), 2800);
    };
    const L = (ja: string) => ja;
    const offs = [
      director.onBanner(setBanner),
      director.onSound((name) => sfx.play(name as SfxName)),
      raid.onEvent((e) => {
        cueFromEvent(director, e);
        if (e.type === 'RAID_STATUS_CHANGED' && e.data.to === 'LOBBY_OPEN') director.reset();
        if (e.type === 'TASK_RESOLVED') {
          const d = e.data;
          const who = d.assist ? '補佐AI' : d.callsign;
          pop(
            `${who} ${ROLE_LABELS[d.role].icon} ${d.success > 0 ? effectSentence(d.effect, L) : 'ミス'}`,
            d.pilotId === PLAYER_ID ? 'mine' : d.success > 0 ? 'good' : 'miss',
          );
        }
        if (e.type === 'ENEMY_DEFEATED' && e.data.callsign)
          pop(`💥 ${e.data.callsign} が撃破！`, 'big');
        if (e.type === 'CITY_REBUILT') pop(`🏗 ${e.data.callsign} が再建！`, 'big');
        if (e.type === 'RAID_STATUS_CHANGED' && e.data.to === 'LOBBY_OPEN') setSeatPatch({});
      }),
      raid.onCheer((c) => {
        pop(`${c.emoji} ${c.callsign}`, 'cheer');
        director.play({ kind: 'cheer' });
      }),
    ];
    const id = setInterval(() => {
      raid.step();
      setTick((x) => x + 1);
    }, 100);
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
  }, [raid, director, sfx, reducedMotion, use3d, contextLost]);

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

  const snap = raid.snapshot();
  const now = raid.gameNow();
  const view = raidView(snap, now);
  const me = raid.state.pilots[PLAYER_ID];
  const seat: SeatState = {
    boarded: !!me,
    role: me?.role ?? null,
    cooldownUntil: me?.cooldownUntil ?? 0,
    roleChangeReadyAt: me ? me.roleChangedAt + snap.config.roleChangeCooldownSeconds * 1000 : 0,
    task: null,
    ...seatPatch,
  };
  const threats = Object.fromEntries(
    Object.entries(view.threats).map(([k, t]) => [k, { seconds: t!.seconds, lethal: t!.lethal }]),
  );
  const lobby = snap.status === 'LOBBY_OPEN';
  const lobbyLeft = snap.lobbyEndsAt
    ? Math.max(0, Math.ceil((snap.lobbyEndsAt - Date.now()) / 1000))
    : 0;

  return (
    <main className="game">
      <section className="stage" aria-label="会場の大画面">
        {use3d && !contextLost ? (
          <ArenaScene
            director={director}
            cities={snap.cities}
            enemies={snap.enemies}
            telegraphs={snap.telegraphs}
            threats={threats}
            cityMaxHp={snap.config.cityMaxHp}
            glow={{
              RAIJIN: 0.15 + 0.85 * (snap.robots[0]!.energy / 100),
              FUJIN: 0.15 + 0.85 * (snap.robots[1]!.energy / 100),
            }}
            reserve={snap.reserveEnergy / 100}
            quality="medium"
            reducedMotion={reducedMotion}
            locale="ja"
            onContextLost={() => setContextLost(true)}
          />
        ) : (
          <div className="flat">
            <JapanMapMini view={view} locale="ja" maxHp={snap.config.cityMaxHp} />
          </div>
        )}
        <div className="hud">
          <div className="hud-top">
            {!lobby && <RaidHeader raid={snap} view={view} locale="ja" />}
          </div>
          {banner && (
            <div className="hud-mid">
              <div
                key={banner.textJa + banner.until}
                className="banner"
                style={{ borderColor: TONE[banner.tone] }}
              >
                <div className="b1" style={{ color: TONE[banner.tone] }}>
                  {banner.textJa}
                </div>
                {banner.subJa && <div className="b2">{banner.subJa}</div>}
              </div>
            </div>
          )}
          {lobby && (
            <div className="lobby" data-testid="solo-lobby">
              <div className="big">出撃まで {lobbyLeft}秒</div>
              <div>搭乗 {snap.crew.length}人 ・ 右のスマホで席を選ぼう</div>
              <button type="button" className="mini" onClick={() => raid.launchNow()}>
                すぐ出撃
              </button>
            </div>
          )}
          {snap.status === 'LIVE' && (
            <div className="threat">
              <ThreatLine view={view} locale="ja" />
            </div>
          )}
          <ul className="pops" aria-hidden>
            {pops.map((p) => (
              <li key={p.id} className={`pop ${p.tone}`}>
                {p.text}
              </li>
            ))}
          </ul>
          {snap.status !== 'ENDED' && !lobby && (
            <div className="robots">
              <RobotBars raid={snap} locale="ja" />
            </div>
          )}
          {snap.status === 'ENDED' && snap.result && (
            <div className="results">
              <ResultCard result={snap.result} locale="ja" />
              <button type="button" className="go" onClick={() => raid.nextRaid()}>
                次の作戦へ
              </button>
            </div>
          )}
          {raid.paused && (
            <div className="cover">
              <div className="big">一時停止中</div>
            </div>
          )}
        </div>
      </section>
      <aside className="phone" aria-label="あなたのスマホ">
        <div className="phone-top">
          <b>📱 {options.callsign}</b>
          <span className="tools">
            <button type="button" onClick={() => void toggleSound()} aria-pressed={sound}>
              {sound ? '🔊' : '🔈'}
            </button>
            <button type="button" onClick={() => raid.setPaused(!raid.paused)}>
              {raid.paused ? '▶' : '⏸'}
            </button>
            <button type="button" onClick={onSettings}>
              ⚙
            </button>
          </span>
        </div>
        <div className="phone-body swc-root">
          {snap.status === 'ENDED' && snap.result ? (
            <p className="swc-wait">
              作戦終了。大画面の結果を見てね。まもなく次の作戦が始まります。
            </p>
          ) : (
            <Cockpit
              client={raid}
              raid={snap}
              seat={seat}
              onSeat={(p) => setSeatPatch((s) => ({ ...s, ...p }))}
              locale="ja"
            />
          )}
          {(lobby || !seat.boarded) && (
            <TrainingPanel locale="ja" initialRole={(seat.role ?? 'GUNNER') as Role} />
          )}
          <div className="cheers">
            {CHEER_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => raid.cheerAsPlayer(e)}
                aria-label={`応援 ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="fine">
            作戦 {raid.raids}回目 ・ 仲間 {options.crew}人
          </p>
        </div>
      </aside>
    </main>
  );
}
