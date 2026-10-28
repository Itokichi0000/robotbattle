import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ActionResult, ActionType, RegionId, RegionState, TeamId } from '@sats-wars/shared';
import {
  ACTION_CODE_LABELS,
  REGION_CENTROIDS,
  REGION_INFO,
  REGION_KIND_META,
  REGION_OUTLINES,
  RESULT_REASON_LABELS,
  TEAM_META,
  eventMessage,
  formatClock,
  mapBounds,
  otherTeam,
  regionKindDescription,
} from '@sats-wars/shared';
import { contributionScore } from '@sats-wars/game-engine';
import {
  ArenaDirector,
  ArenaScene,
  type Banner,
  SfxEngine,
  type SfxName,
  cueFromEvent,
} from '@sats-wars/three-game';
import { LocalMatch, PLAYER_ID, type SoloOptions } from './localMatch';

const NEUTRAL = '#41506E';
const color = (t: TeamId | null) => (t ? TEAM_META[t].color : NEUTRAL);

export function App() {
  const [options, setOptions] = useState<SoloOptions | null>(null);
  const [round, setRound] = useState(0);
  if (!options) return <Setup onStart={(o) => setOptions(o)} />;
  return (
    <Game
      key={round}
      options={options}
      onRestart={() => setRound((r) => r + 1)}
      onSettings={() => setOptions(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Seg<T extends string | number>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ v: T; label: string; sub?: string; cls?: string }>;
}) {
  return (
    <div className="seg" role="group">
      {items.map((it) => (
        <button
          key={String(it.v)}
          type="button"
          className={it.cls}
          aria-pressed={value === it.v}
          onClick={() => onChange(it.v)}
        >
          {it.label}
          {it.sub && <small>{it.sub}</small>}
        </button>
      ))}
    </div>
  );
}

function Setup({ onStart }: { onStart: (o: SoloOptions) => void }) {
  const [nickname, setNickname] = useState('');
  const [team, setTeam] = useState<SoloOptions['team']>('AUTO');
  const [teamSize, setTeamSize] = useState(6);
  const [playerAp, setPlayerAp] = useState(10);
  const [speed, setSpeed] = useState(2);
  return (
    <main className="setup">
      <section>
        <h1 className="title">
          <span className="r">SATS</span> <span className="f">WARS</span>
        </h1>
        <div className="versus">
          <span className="raijin">雷神</span> VS <span className="fujin">風神</span>
        </div>
        <p className="lede">
          日本の8地方を取り合い、45秒ごとに巨大ロボットが激突するチーム戦。会場ではスマホから参加し、
          大型スクリーンで決着を見届けます。この体験版はブラウザだけで動き、味方と敵はBOTが務めます。
        </p>
        <span className="tag">オフライン体験版・実際の支払いは発生しません</span>
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div>
              <b>チームに参加してAPを受け取る</b>
              <span>会場では21 sats（またはスポンサーパス）で3AP。体験版は支払いなしです。</span>
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div>
              <b>⚔ 攻撃 ・ 🛡 防御 ・ ◆ 充電</b>
              <span>
                中立地は1回で占領。敵地は「争奪」を始め、25秒以内にもう1回攻撃で奪取。拠点の種類がロボットを強くします。
              </span>
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div>
              <b>45秒ごとにロボット激突</b>
              <span>
                攻撃拠点は与ダメージ、防御拠点は被ダメージ、エネルギー拠点と充電は必殺技に効きます。
              </span>
            </div>
          </li>
        </ol>
      </section>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ nickname: nickname.trim() || 'あなた', team, teamSize, playerAp, speed });
        }}
      >
        <div className="field">
          <label htmlFor="nick">ニックネーム</label>
          <input
            id="nick"
            maxLength={12}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例：さとし"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <span className="lbl">チーム</span>
          <Seg
            value={team}
            onChange={setTeam}
            items={[
              { v: 'AUTO', label: 'おまかせ', sub: '会場と同じ自動振分' },
              { v: 'RAIJIN', label: '⚡ 雷神', sub: '橙・重装', cls: 'r' },
              { v: 'FUJIN', label: '🌀 風神', sub: '青緑・機動', cls: 'f' },
            ]}
          />
        </div>
        <div className="field">
          <span className="lbl">1チームの人数（あなた＋BOT）</span>
          <Seg
            value={teamSize}
            onChange={setTeamSize}
            items={[
              { v: 3, label: '3人', sub: '少人数' },
              { v: 6, label: '6人', sub: '標準' },
              { v: 15, label: '15人', sub: '大混戦' },
            ]}
          />
        </div>
        <div className="field">
          <span className="lbl">あなたのAP</span>
          <Seg
            value={playerAp}
            onChange={setPlayerAp}
            items={[
              { v: 3, label: '3 AP', sub: '会場ルール' },
              { v: 10, label: '10 AP', sub: '体験用に多め' },
            ]}
          />
        </div>
        <div className="field">
          <span className="lbl">試合の速さ</span>
          <Seg
            value={speed}
            onChange={setSpeed}
            items={[
              { v: 1, label: '等倍', sub: '5分（本番と同じ）' },
              { v: 2, label: '2倍速', sub: '2分30秒' },
            ]}
          />
        </div>
        <button className="go" type="submit">
          出撃する
        </button>
        <p className="fine">
          両チームの性能は同じで、違うのは見た目と演出だけです。勝敗はゲームエンジンが決め、3D映像はその結果を再生します。
          体験版では実行前の確認を省いています（会場のスマホ版では確認画面が出ます）。
        </p>
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

function Game({
  options,
  onRestart,
  onSettings,
}: {
  options: SoloOptions;
  onRestart: () => void;
  onSettings: () => void;
}) {
  // Start immediately so the player exists before the first render.
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
  const [hp, setHp] = useState<Record<TeamId, number>>({ RAIJIN: 100, FUJIN: 100 });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [last, setLast] = useState<ActionResult | null>(null);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [sound, setSound] = useState(false);
  const [use3d] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  const gameMsRef = useRef(0);
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  useEffect(() => {
    director.settings = { reducedMotion, shakeScale: 0.7, shortSpecials: false };
    director.syncHp({ RAIJIN: 100, FUJIN: 100 }, match.state.config.hpMax);
    const offs = [
      director.onHp((h) => setHp({ ...h })),
      director.onBanner(setBanner),
      director.onSound((name) => sfx.play(name as SfxName)),
      match.onEvent((e) => cueFromEvent(director, e)),
    ];
    director.play({ kind: 'intro' });
    const id = setInterval(() => {
      match.tick();
      gameMsRef.current = match.gameMs();
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
  }, [match, director, sfx, reducedMotion, use3d, contextLost]);

  // If a cinematic was skipped, snap the HUD to the authoritative HP.
  const s = match.state;
  useEffect(() => {
    if (!director.busy && (hp.RAIJIN !== s.teams.RAIJIN.hp || hp.FUJIN !== s.teams.FUJIN.hp)) {
      director.syncHp({ RAIJIN: s.teams.RAIJIN.hp, FUJIN: s.teams.FUJIN.hp });
    }
  });

  const act = (type: ActionType, regionId: RegionId | null) => {
    const r = match.act(type, regionId);
    setLast(r);
  };

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

  const regions = s.regionOrder.map((id) => s.regions[id]);
  return (
    <main className="game">
      <section className="stage" aria-label="会場スクリーン">
        {use3d && !contextLost ? (
          <ArenaScene
            director={director}
            regions={regions}
            teams={s.teams}
            energyMax={s.config.energyMax}
            gameMsRef={gameMsRef}
            quality="medium"
            reducedMotion={reducedMotion}
            locale="ja"
            onContextLost={() => setContextLost(true)}
          />
        ) : (
          <FlatStage regions={regions} gameMs={match.gameMs()} />
        )}
        <Hud match={match} hp={hp} banner={banner} />
        <Covers match={match} onRestart={onRestart} onSettings={onSettings} />
      </section>
      <Panel
        match={match}
        last={last}
        onAct={act}
        selected={selected}
        onSelect={setSelected}
        sound={sound}
        onSound={toggleSound}
        onRestart={onRestart}
        onSettings={onSettings}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------
// HUD over the arena
// ---------------------------------------------------------------------------

function Gauge({
  match,
  teamId,
  hp,
  side,
}: {
  match: LocalMatch;
  teamId: TeamId;
  hp: number;
  side: 'left' | 'right';
}) {
  const s = match.state;
  const m = TEAM_META[teamId];
  const t = s.teams[teamId];
  const cfg = s.config;
  const ready = t.energy >= cfg.specialThreshold;
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
          <small>/{cfg.hpMax}</small>
        </div>
      </div>
      <div
        className="bar"
        role="meter"
        aria-label={`${m.nameJa} HP`}
        aria-valuenow={hp}
        aria-valuemin={0}
        aria-valuemax={cfg.hpMax}
      >
        <i
          style={{
            width: `${(hp / cfg.hpMax) * 100}%`,
            background: `linear-gradient(90deg, ${m.colorDark}, ${m.color}, ${m.colorLight})`,
          }}
        />
      </div>
      <div className={`en ${ready ? 'ready' : ''}`}>
        <span className="num">
          EN {t.energy}/{cfg.energyMax}
          {ready ? ' 必殺OK' : ''}
        </span>
        <div className="bar">
          <i style={{ width: `${(t.energy / cfg.energyMax) * 100}%` }} />
          <span
            className="mark"
            style={{ left: `${(cfg.specialThreshold / cfg.energyMax) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Hud({
  match,
  hp,
  banner,
}: {
  match: LocalMatch;
  hp: Record<TeamId, number>;
  banner: Banner | null;
}) {
  const s = match.state;
  const g = match.gameMs();
  const next =
    s.status === 'LIVE' && s.clashes.length < s.config.clashTimesMs.length
      ? s.config.clashTimesMs[s.nextClashIndex]
      : undefined;
  const nextIn = next !== undefined ? next - g : null;
  const label =
    s.status === 'LOBBY'
      ? '参加受付中'
      : s.status === 'LIVE'
        ? '対戦中'
        : s.status === 'PAUSED'
          ? '一時停止中'
          : s.status === 'FINALIZING'
            ? '最終決戦'
            : '試合終了';
  const feed = useFeed(match);
  return (
    <div className="hud">
      <div className="hud-top">
        <Gauge match={match} teamId="RAIJIN" hp={hp.RAIJIN} side="left" />
        <div className="clock">
          <div className="st">{label}</div>
          <div className="big num">
            {s.status === 'LOBBY'
              ? formatClock(-g)
              : s.status === 'FINALIZING' || s.status === 'FINISHED'
                ? 'FINAL'
                : formatClock(s.config.actionCloseMs - g)}
          </div>
          {nextIn !== null && (
            <div className={`chip num ${nextIn < 10_000 ? 'hot' : ''}`}>
              あと{Math.ceil(nextIn / 1000)}秒で激突！
            </div>
          )}
        </div>
        <Gauge match={match} teamId="FUJIN" hp={hp.FUJIN} side="right" />
      </div>
      <div className="hud-mid">
        {banner && (
          <div
            className="banner"
            key={banner.textJa + banner.until}
            style={{ borderColor: banner.teamId ? TEAM_META[banner.teamId].color : undefined }}
          >
            <b style={{ color: banner.teamId ? TEAM_META[banner.teamId].color : undefined }}>
              {banner.textJa}
            </b>
            <span>{banner.textEn}</span>
          </div>
        )}
      </div>
      <div className="hud-bottom">
        <div className="ticker" aria-live="polite">
          {feed.slice(0, 3).map((f) => (
            <div key={f.seq} style={{ borderLeftColor: color(f.teamId) }}>
              {f.text}
            </div>
          ))}
        </div>
        <div className="fair num">
          <span className="raijin">
            ⚡ {s.teams.RAIJIN.participantCount}人 AP {s.teams.RAIJIN.apRemaining}
          </span>
          {'  ・  '}
          <span className="fujin">
            🌀 {s.teams.FUJIN.participantCount}人 AP {s.teams.FUJIN.apRemaining}
          </span>
        </div>
      </div>
    </div>
  );
}

function useFeed(match: LocalMatch) {
  const [feed, setFeed] = useState<Array<{ seq: number; teamId: TeamId | null; text: string }>>([]);
  useEffect(
    () =>
      match.onEvent((e) => {
        const m = eventMessage(e, 'ja');
        if (m) setFeed((f) => [m, ...f].slice(0, 8));
      }),
    [match],
  );
  return feed;
}

function Covers({
  match,
  onRestart,
  onSettings,
}: {
  match: LocalMatch;
  onRestart: () => void;
  onSettings: () => void;
}) {
  const s = match.state;
  if (s.status === 'LOBBY') {
    return (
      <div className="cover">
        <div>
          <div className="mid">まもなく開戦</div>
          <div className="big num">{formatClock(-match.gameMs())}</div>
          <button className="btn primary" type="button" onClick={() => match.startNow()}>
            今すぐ開始
          </button>
        </div>
      </div>
    );
  }
  if (s.status === 'PAUSED') {
    return (
      <div className="cover">
        <div>
          <div className="mid">一時停止中</div>
          <button className="btn primary" type="button" onClick={() => match.resume()}>
            再開する
          </button>
        </div>
      </div>
    );
  }
  if (s.status === 'FINISHED' && s.result) {
    const r = s.result;
    const you = s.participants[PLAYER_ID]!;
    const won = r.winnerTeamId === you.teamId;
    return (
      <div className="cover final" role="dialog" aria-label="試合結果">
        <div className="result">
          <div
            className="mid"
            style={{ color: r.winnerTeamId ? TEAM_META[r.winnerTeamId].color : undefined }}
          >
            {r.winnerTeamId ? `${TEAM_META[r.winnerTeamId].nameJa}の勝利！` : '引き分け'}
          </div>
          <div>
            {RESULT_REASON_LABELS[r.reason].ja}
            {r.winnerTeamId && (won ? ' ・ あなたのチームの勝ち！' : ' ・ ナイスファイト！')}
          </div>
          <div className="stats num">
            <span>HP</span>
            <span className="raijin">雷神 {r.finalHp.RAIJIN}</span>
            <span className="fujin">風神 {r.finalHp.FUJIN}</span>
            <span>地域</span>
            <span className="raijin">{r.regionCounts.RAIJIN}</span>
            <span className="fujin">{r.regionCounts.FUJIN}</span>
            <span>MVP</span>
            <span className="raijin">{r.mvp.RAIJIN?.nickname ?? '—'}</span>
            <span className="fujin">{r.mvp.FUJIN?.nickname ?? '—'}</span>
          </div>
          <div>あなたの貢献スコア：{contributionScore(you.contribution)}</div>
          <div className="tools">
            <button className="btn primary" type="button" onClick={onRestart}>
              もう一度
            </button>
            <button className="btn" type="button" onClick={onSettings}>
              設定を変える
            </button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commander panel (the phone controller in the real game)
// ---------------------------------------------------------------------------

function hint(type: 'ATTACK' | 'DEFEND', r: RegionState, mine: TeamId): string | null {
  const enemy = otherTeam(mine);
  if (type === 'ATTACK') {
    if (r.ownerTeamId === null) return '中立：1回で占領';
    if (r.ownerTeamId === enemy) {
      if (r.contestedByTeamId === mine) return '争奪中：攻撃で奪取';
      if (r.shieldCharges > 0) return 'シールドを破壊';
      return '争奪を開始';
    }
    if (r.contestedByTeamId === enemy) return '敵の争奪を阻止';
    return null;
  }
  if (r.ownerTeamId !== mine) return null;
  if (r.contestedByTeamId) return '争奪を解除';
  if (r.shieldCharges > 0) return null;
  return 'シールド30秒';
}

function Panel({
  match,
  last,
  onAct,
  selected,
  onSelect,
  sound,
  onSound,
  onRestart,
  onSettings,
}: {
  match: LocalMatch;
  last: ActionResult | null;
  onAct: (t: ActionType, r: RegionId | null) => void;
  selected: RegionId | null;
  onSelect: (r: RegionId | null) => void;
  sound: boolean;
  onSound: () => void;
  onRestart: () => void;
  onSettings: () => void;
}) {
  const s = match.state;
  const you = s.participants[PLAYER_ID]!;
  const mine = you.teamId;
  const meta = TEAM_META[mine];
  const live = s.status === 'LIVE';
  const canAct = live && you.apRemaining > 0;
  const g = match.gameMs();
  const next = live ? s.config.clashTimesMs[s.nextClashIndex] : undefined;
  return (
    <aside className="panel" aria-label="作戦パネル" style={{ borderColor: meta.color }}>
      <div className="me">
        <div>
          <div className="team" style={{ color: meta.color }}>
            {meta.symbol} {meta.nameJa}チーム
          </div>
          <div className="who">
            {you.nickname} ・ 必殺技「{meta.specialJa}」
          </div>
        </div>
        <div className="ap">
          <div className="lbl">AP</div>
          <div className="pips" aria-label={`残りAP ${you.apRemaining}`}>
            {Array.from({ length: you.apTotal }, (_, i) => (
              <i key={i} className={i < you.apRemaining ? 'on' : ''} />
            ))}
          </div>
          <div className="num">
            {you.apRemaining}/{you.apTotal}
          </div>
        </div>
      </div>

      <div className="status num">
        <span>
          次の激突 <b>{next !== undefined ? formatClock(next - g) : '--'}</b>
        </span>
        <span>
          残り{' '}
          <b>{live || s.status === 'PAUSED' ? formatClock(s.config.actionCloseMs - g) : '--'}</b>
        </span>
      </div>

      {last && (
        <div className={`toast ${last.ok ? 'ok' : 'bad'}`} role="status">
          {ACTION_CODE_LABELS[last.code].ja}
          {last.ok ? `（残りAP ${last.apAfter}）` : '（APは消費されていません）'}
        </div>
      )}

      <MiniMap
        regions={s.regionOrder.map((id) => s.regions[id])}
        mine={mine}
        selected={selected}
        onSelect={onSelect}
        gameMs={g}
        live={live || s.status === 'PAUSED'}
      />

      <ul className="regions">
        {s.regionOrder.map((id) => {
          const r = s.regions[id];
          const kind = REGION_KIND_META[r.kind];
          const atk = hint('ATTACK', r, mine);
          const def = hint('DEFEND', r, mine);
          const owner = r.ownerTeamId === null ? '中立' : r.ownerTeamId === mine ? '味方' : '敵';
          const left =
            r.contestedUntil !== null ? Math.max(0, Math.ceil((r.contestedUntil - g) / 1000)) : 0;
          return (
            <li
              key={id}
              className={`region ${selected === id ? 'sel' : ''}`}
              style={{ borderLeftColor: color(r.ownerTeamId) }}
              onMouseEnter={() => onSelect(id)}
            >
              <div>
                <div className="nm">
                  {kind.icon} {REGION_INFO[id].labelJa}
                </div>
                <div className="sub">{regionKindDescription(r.kind, s.config, 'ja')}</div>
                <div className="state" style={{ color: color(r.ownerTeamId) }}>
                  {r.ownerTeamId ? TEAM_META[r.ownerTeamId].symbol : '○'} {owner}
                  {r.shieldCharges > 0 && ' 🛡'}
                  {r.contestedByTeamId && live && (
                    <span style={{ color: 'var(--gold)' }}>
                      {' '}
                      {r.contestedByTeamId === mine ? '味方が争奪中' : '敵が争奪中'} {left}s
                    </span>
                  )}
                </div>
              </div>
              <div className="acts">
                <button
                  type="button"
                  className="act atk"
                  disabled={!canAct || !atk}
                  title={atk ?? '攻撃できません'}
                  onClick={() => onAct('ATTACK', id)}
                >
                  ⚔ 攻撃
                </button>
                <button
                  type="button"
                  className="act def"
                  disabled={!canAct || !def}
                  title={def ?? '防御できません'}
                  onClick={() => onAct('DEFEND', id)}
                >
                  🛡 防御
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="charge"
        disabled={!canAct || s.teams[mine].energy >= s.config.energyMax}
        onClick={() => onAct('CHARGE', null)}
      >
        ◆ 充電 +{s.config.chargeAmount}（EN {s.teams[mine].energy}/{s.config.energyMax}）
      </button>

      <div className="tools">
        <button className="btn" type="button" onClick={onSound} aria-pressed={sound}>
          {sound ? '🔊 音声ON' : '🔇 音声OFF'}
        </button>
        {live && (
          <button className="btn" type="button" onClick={() => match.pause()}>
            一時停止
          </button>
        )}
        <button className="btn" type="button" onClick={onRestart}>
          最初から
        </button>
        <button className="btn" type="button" onClick={onSettings}>
          設定
        </button>
      </div>
      <p className="hint">
        攻撃拠点⚔は与ダメージ+{s.config.attackRegionBonus}、防御拠点🛡は被ダメージ−
        {s.config.defenseRegionReduction}、 エネルギー拠点◆は激突ごとにEN+
        {s.config.energyRegionGain}。EN{s.config.specialThreshold}以上で必殺技が自動で出ます。
        争奪中の地域はボーナスが止まります。
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// 2D maps (mini map in the panel; full stage when WebGL is unavailable)
// ---------------------------------------------------------------------------

const B = mapBounds();
const VB = `${B.minX - 0.5} ${-B.maxY - 0.5} ${B.maxX - B.minX + 1} ${B.maxY - B.minY + 1}`;
const PATHS = Object.fromEntries(
  Object.entries(REGION_OUTLINES).map(([id, polys]) => [
    id,
    polys
      .map((p) => `M${p.map((pt) => `${pt.x.toFixed(2)},${(-pt.y).toFixed(2)}`).join('L')}Z`)
      .join(' '),
  ]),
) as Record<RegionId, string>;

function MiniMap({
  regions,
  mine,
  selected,
  onSelect,
  gameMs,
  big = false,
  live = true,
}: {
  live?: boolean;
  regions: RegionState[];
  mine?: TeamId;
  selected?: RegionId | null;
  onSelect?: (id: RegionId) => void;
  gameMs: number;
  big?: boolean;
}) {
  const fs = big ? 0.6 : 0.75;
  return (
    <svg
      viewBox={VB}
      className={big ? undefined : 'minimap'}
      style={big ? { width: '100%', height: '100%' } : undefined}
      role="img"
      aria-label="日本地図の戦況"
    >
      <defs>
        {(['RAIJIN', 'FUJIN'] as const).map((t) => (
          <pattern
            key={t}
            id={`h-${t}`}
            width="0.5"
            height="0.5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="0.5" stroke={TEAM_META[t].color} strokeWidth="0.22" />
          </pattern>
        ))}
      </defs>
      {regions.map((r) => (
        <g
          key={r.regionId}
          onClick={() => onSelect?.(r.regionId)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          <path
            d={PATHS[r.regionId]}
            fill={color(r.ownerTeamId)}
            fillOpacity={r.ownerTeamId ? 0.9 : 0.55}
            stroke={selected === r.regionId ? '#EFF5FF' : '#070D1A'}
            strokeWidth={selected === r.regionId ? 0.2 : 0.06}
          />
          {r.contestedByTeamId && (
            <path d={PATHS[r.regionId]} fill={`url(#h-${r.contestedByTeamId})`} />
          )}
        </g>
      ))}
      {regions.map((r) => {
        const c = REGION_CENTROIDS[r.regionId];
        const rel =
          r.ownerTeamId === null
            ? ''
            : mine
              ? r.ownerTeamId === mine
                ? '味方'
                : '敵'
              : TEAM_META[r.ownerTeamId].symbol;
        const left =
          live && r.contestedUntil !== null
            ? Math.max(0, Math.ceil((r.contestedUntil - gameMs) / 1000))
            : null;
        return (
          <text
            key={`t-${r.regionId}`}
            x={c.x}
            y={-c.y}
            textAnchor="middle"
            fontSize={fs}
            fontWeight={700}
            fill="#EFF5FF"
            stroke="#070D1A"
            strokeWidth={fs * 0.18}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {REGION_KIND_META[r.kind].icon}
            {REGION_INFO[r.regionId].shortJa}
            {rel ? ` ${rel}` : ''}
            {r.shieldCharges > 0 ? '🛡' : ''}
            {left !== null && r.contestedByTeamId ? ` ${left}s` : ''}
          </text>
        );
      })}
    </svg>
  );
}

function FlatStage({ regions, gameMs }: { regions: RegionState[]; gameMs: number }) {
  return (
    <div style={{ position: 'absolute', inset: '14% 22% 12%' }}>
      <MiniMap regions={regions} gameMs={gameMs} big />
    </div>
  );
}
