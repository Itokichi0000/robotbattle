import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Role, TeamId } from '@sats-wars/shared';
import { ONE_LINE_RULES } from '@sats-wars/shared';
import {
  ArenaDirector,
  ArenaScene,
  type Banner,
  type FrameStats,
  type GovernorLevel,
  type Quality,
  QualityGovernor,
  SfxEngine,
  connectDirectorAudio,
  cueFromEvent,
} from '@sats-wars/three-game';
import {
  type CommsItem,
  type ConsoleCallout,
  Icon,
  type IconName,
  PilotConsole,
  type SeatState,
  type TargetDesignation,
  effectSentence,
  raidView,
} from '@sats-wars/ui';
import { LocalRaid, PLAYER_ID, type SoloOptions } from './localRaid';

/** Picture settings chosen on the registration screen (not part of the raid). */
export interface Display {
  quality: Quality;
  /** Step the quality down (finally to 2D) when the frame rate stays low. */
  autoQuality: boolean;
}

/** Spec 6.3 names: High / Balanced / Low. */
const QUALITY_LABELS: Record<Quality, { name: string; ja: string; hint: string }> = {
  high: { name: 'HIGH', ja: '高', hint: '影・光・破片・後処理' },
  medium: { name: 'BALANCED', ja: '標準', hint: '光と後処理を軽く' },
  low: { name: 'LOW', ja: '軽量', hint: 'モバイル・古い端末' },
};

/** The robot a station flies (the hangar camera looks at it). */
const ROBOT_OF: Record<Role, TeamId | 'BOTH'> = {
  GUNNER: 'RAIJIN',
  GUARDIAN: 'FUJIN',
  ROUTER: 'BOTH',
  ENGINEER: 'BOTH',
};

/** Phones and tablets start at Balanced; computers at High. */
function defaultQuality(): Quality {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ? 'medium' : 'high';
  } catch {
    return 'medium';
  }
}

export function App() {
  const [options, setOptions] = useState<SoloOptions | null>(null);
  const [display, setDisplay] = useState<Display>(() => ({
    quality: defaultQuality(),
    autoQuality: true,
  }));
  if (!options)
    return (
      <Registration
        display={display}
        onStart={(o, d) => {
          setDisplay(d);
          setOptions(o);
        }}
      />
    );
  return <Game options={options} display={display} onSettings={() => setOptions(null)} />;
}

// ---------------------------------------------------------------------------
// Pilot registration (the offline stand-in for the venue's pilot login)
// ---------------------------------------------------------------------------

const STEPS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'station',
    title: 'ステーションに搭乗',
    body: '砲撃・防衛・電力・整備の4席。いま手が足りない席は格納庫の一覧が教えてくれます。',
  },
  {
    icon: 'launch',
    title: '操作して機体を動かす',
    body: '数秒の操作（照準・防御・配線・修理）が成功すると、雷神と風神が動きます。',
  },
  {
    icon: 'city',
    title: '8分間、日本を守る',
    body: '予告された攻撃から都市を守り、NULL CORE を撃破。最後は3席がそろって神雷風陣。',
  },
];

function Registration({
  display,
  onStart,
}: {
  display: Display;
  onStart: (o: SoloOptions, d: Display) => void;
}) {
  const [callsign, setCallsign] = useState('');
  const [crew, setCrew] = useState(5);
  const [quality, setQuality] = useState<Quality>(display.quality);
  const [autoQuality, setAutoQuality] = useState(display.autoQuality);
  return (
    <main className="hud-root reg">
      <section className="reg-brief">
        <span className="hud-label">PROJECT THE LAST DEFENSE · OFFLINE SIMULATION</span>
        <h1 className="reg-title">
          SATS WARS
          <span>EARTH DEFENSE</span>
        </h1>
        <p className="reg-oneline">{ONE_LINE_RULES.ja}</p>
        <ol className="reg-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="hud-num reg-step-n">{String(i + 1).padStart(2, '0')}</span>
              <Icon name={s.icon} size={20} />
              <span>
                <b>{s.title}</b>
                {s.body}
              </span>
            </li>
          ))}
        </ol>
        <p className="reg-fine">
          オフライン体験版：会場では大画面とスマホに分かれます。支払いは発生しません（会場では1作戦
          21 sats の出撃パス、または無料イベント）。
        </p>
      </section>
      <form
        className="reg-form hud-frame"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(
            {
              callsign: callsign.trim() || 'あなた',
              crew,
              botSkill: 0.65,
              speed: rehearsalSpeed(),
            },
            { quality, autoQuality },
          );
        }}
      >
        <span className="hud-frame-label">PILOT REGISTRATION</span>
        <label className="reg-field">
          <span className="hud-label">CALLSIGN · コールサイン（任意）</span>
          <input
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            maxLength={20}
            placeholder="例：サトシ"
          />
        </label>
        <div className="reg-field">
          <span className="hud-label">WINGMEN · いっしょに乗る仲間（デモBOT）</span>
          <div className="reg-seg" role="group" aria-label="仲間の数">
            {[0, 3, 5, 8, 12].map((n) => (
              <button
                key={n}
                type="button"
                className={crew === n ? 'is-on' : ''}
                aria-pressed={crew === n}
                onClick={() => setCrew(n)}
              >
                <span className="hud-num">{n === 0 ? 'SOLO' : n}</span>
                <small>{n === 0 ? 'ひとり' : '人'}</small>
              </button>
            ))}
          </div>
          <span className="hud-hint">
            少人数のときは補佐AIが空いた席を手伝います（記録は「AI支援あり」）。
          </span>
        </div>
        <div className="reg-field">
          <span className="hud-label">RENDER · 画質（3D）</span>
          <div className="reg-seg" role="group" aria-label="画質">
            {(['high', 'medium', 'low'] as const).map((q) => (
              <button
                key={q}
                type="button"
                className={quality === q ? 'is-on' : ''}
                aria-pressed={quality === q}
                data-testid={`solo-quality-${q}`}
                onClick={() => setQuality(q)}
              >
                <span className="hud-num">{QUALITY_LABELS[q].name}</span>
                <small>{QUALITY_LABELS[q].hint}</small>
              </button>
            ))}
          </div>
          <label className="reg-check">
            <input
              type="checkbox"
              checked={autoQuality}
              data-testid="solo-auto-quality"
              onChange={(e) => setAutoQuality(e.target.checked)}
            />
            動きが重いときは自動で画質を下げる
          </label>
        </div>
        <button type="submit" className="hud-trigger is-board reg-go" data-testid="solo-start">
          <Icon name="launch" size={22} />
          <span className="hud-trigger-word">格納庫へ</span>
        </button>
        <p className="hud-hint reg-note">オフライン体験版・実際の支払いは発生しません</p>
      </form>
    </main>
  );
}

/**
 * `?speed=4` runs the raid clock faster for rehearsals and screenshots (the
 * whole 8-minute raid in 2); `?speed=0.25` slows it (a long lobby for hangar
 * shots). Not offered in the UI; 1 otherwise.
 */
function rehearsalSpeed(): number {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('speed'));
    return Number.isFinite(v) && v >= 0.1 && v <= 8 ? v : 1;
  } catch {
    return 1;
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const L = (ja: string, _en: string) => ja;

// ---------------------------------------------------------------------------
// Game: the pilot console over the 3D arena
// ---------------------------------------------------------------------------

function Game({
  options,
  display,
  onSettings,
}: {
  options: SoloOptions;
  display: Display;
  onSettings: () => void;
}) {
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
  const [comms, setComms] = useState<CommsItem[]>([]);
  const [sound, setSound] = useState(false);
  const [use3d] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  // Automatic quality: steps down on a sustained low frame rate, finally to 2D.
  const [level, setLevel] = useState<GovernorLevel>(display.quality);
  const governor = useMemo(
    () => (display.autoQuality ? new QualityGovernor({ ceiling: display.quality }) : null),
    [display],
  );
  const onStats = (s: FrameStats) => {
    const next = governor?.sample(s.fps, performance.now() / 1000);
    if (next) setLevel(next);
  };
  const [seatPatch, setSeatPatch] = useState<Partial<SeatState>>({});
  const designation = useRef<TargetDesignation | null>(null);
  const ids = useRef(0);
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  useEffect(() => {
    director.settings = { reducedMotion, shakeScale: 0.7, shortSpecials: false };
    director.timeScale = 1;
    // Comms: my own results and the big moments always; the crowd's results at
    // most one every 2 s so the latest line stays readable (spec 3.2).
    let lastAlly = 0;
    const say = (item: Omit<CommsItem, 'id'>, priority: boolean) => {
      const now = performance.now();
      if (!priority) {
        if (now - lastAlly < 2000) return;
        lastAlly = now;
      }
      setComms((xs) => [...xs.slice(-29), { ...item, id: String(++ids.current) }]);
    };
    const offs = [
      director.onBanner(setBanner),
      connectDirectorAudio(director, sfx),
      raid.onEvent((e) => {
        cueFromEvent(director, e);
        if (e.type === 'RAID_STATUS_CHANGED' && e.data.to === 'LOBBY_OPEN') {
          director.reset();
          setSeatPatch({});
          setComms([]);
        }
        if (e.type === 'TASK_RESOLVED') {
          const d = e.data;
          const mine = d.pilotId === PLAYER_ID;
          const who = mine ? 'あなた' : d.assist ? '補佐AI' : d.callsign;
          say(
            {
              text: `${who}：${d.success > 0 ? effectSentence(d.effect, L) : 'ミス'}`,
              role: d.role,
              tone: mine ? 'mine' : d.success > 0 ? 'ally' : 'miss',
            },
            mine,
          );
        }
        if (e.type === 'ENEMY_DEFEATED' && e.data.callsign)
          say({ text: `${e.data.callsign} が敵を撃破`, tone: 'big' }, true);
        if (e.type === 'CITY_REBUILT')
          say({ text: `${e.data.callsign} が都市を再建`, tone: 'big' }, true);
      }),
      raid.onCheer(() => director.play({ kind: 'cheer' })),
    ];
    const id = setInterval(() => {
      raid.step();
      setTick((x) => x + 1);
    }, 100);
    // Without WebGL nothing drives the director clock, so do it here.
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      if (!use3d || contextLost || level === '2d') director.update((now - prev) / 1000);
      prev = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      offs.forEach((o) => o());
      clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [raid, director, sfx, reducedMotion, use3d, contextLost, level]);

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

  const base = raid.snapshot();
  // The demo's pause freezes the local engine; show it as the raid's HOLD.
  const snap =
    raid.paused && base.status === 'LIVE' ? { ...base, status: 'PAUSED' as const } : base;
  const view = raidView(snap, raid.gameNow());
  const me = raid.state.pilots[PLAYER_ID];
  const seat: SeatState = {
    boarded: !!me,
    role: me?.role ?? null,
    cooldownUntil: me?.cooldownUntil ?? 0,
    roleChangeReadyAt: me ? me.roleChangedAt + snap.config.roleChangeCooldownSeconds * 1000 : 0,
    task: null,
    ...seatPatch,
  };
  const lobby = snap.status === 'LOBBY_OPEN' || snap.status === 'CREATED';

  // Hangar camera: on the robot of the boarded (or browsed) station.
  const [browsing, setBrowsing] = useState<Role | null>(null);
  const focus = browsing ?? seat.role;
  useEffect(() => {
    if (lobby) director.hangarView(focus ? ROBOT_OF[focus] : 'BOTH');
  }, [lobby, focus, director]);
  useEffect(() => {
    if (!lobby) setBrowsing(null);
  }, [lobby]);

  const threats = Object.fromEntries(
    Object.entries(view.threats).map(([k, t]) => [k, { seconds: t!.seconds, lethal: t!.lethal }]),
  );
  const callout: ConsoleCallout | null = banner
    ? {
        title: banner.textJa,
        sub: banner.subJa,
        tone: banner.tone === 'enemy' ? 'enemy' : banner.tone === 'neutral' ? 'neutral' : 'ally',
      }
    : null;
  const show3d = use3d && !contextLost && level !== '2d';

  return (
    <PilotConsole
      client={raid}
      raid={snap}
      seat={seat}
      onSeat={(p) => setSeatPatch((s) => ({ ...s, ...p }))}
      locale="ja"
      pilot={{
        callsign: options.callsign,
        detail: (
          <span className="hud-hint">
            OFFLINE SIM · 作戦 {raid.raids}回目 · 仲間 {options.crew}人
          </span>
        ),
      }}
      backdrop={
        show3d ? (
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
            health={{ RAIJIN: snap.robots[0]!.health, FUJIN: snap.robots[1]!.health }}
            bossBarrier={view.bossBarrier}
            crew={snap.crew}
            quality={level}
            reducedMotion={reducedMotion}
            locale="ja"
            onStats={onStats}
            onContextLost={() => setContextLost(true)}
            designation={designation}
            focusStation={lobby ? focus : null}
          />
        ) : undefined
      }
      lobbyEndsAt={snap.lobbyEndsAt}
      callout={callout}
      comms={comms}
      onCheer={(e) => raid.cheerAsPlayer(e)}
      onLaunchNow={() => raid.launchNow()}
      onFocusStation={setBrowsing}
      designation={designation}
      reducedMotion={reducedMotion}
      controls={
        <>
          <button
            type="button"
            className="hud-icon-btn"
            onClick={() => void toggleSound()}
            aria-pressed={sound}
            aria-label={sound ? '音を消す' : '音を出す'}
            data-testid="solo-sound"
          >
            <Icon name={sound ? 'sound' : 'mute'} size={18} />
          </button>
          {!lobby && snap.status !== 'ENDED' && (
            <button
              type="button"
              className="hud-icon-btn"
              onClick={() => raid.setPaused(!raid.paused)}
              aria-label={raid.paused ? '再開' : '一時停止'}
              data-testid="solo-pause"
            >
              <Icon name={raid.paused ? 'play' : 'pause'} size={18} />
            </button>
          )}
        </>
      }
      menu={
        <section>
          <span className="hud-label">SIMULATION</span>
          <p className="hud-hint">
            画質 {level === '2d' ? '2D' : QUALITY_LABELS[level].name}
            {level !== display.quality ? '（自動で調整）' : ''} · 作戦 {raid.raids}回目
          </p>
          <button type="button" className="hud-btn" onClick={onSettings}>
            <Icon name="back" size={16} />
            登録画面に戻る
          </button>
        </section>
      }
      debriefActions={
        <button
          type="button"
          className="hud-btn hud-btn-primary"
          onClick={() => raid.nextRaid()}
          data-testid="solo-next"
        >
          <Icon name="launch" size={18} />
          次の作戦へ
        </button>
      }
    />
  );
}
