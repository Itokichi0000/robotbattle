import type { Direction, EnergySink, RegionId, RobotState } from '@sats-wars/shared';
import { DIRECTIONS, ENEMY_LABELS, SINK_LABELS, WEAKPOINT_LABELS } from '@sats-wars/shared';
import type { ChoiceOption } from '../board';
import { cityName } from '../board';
import { ENEMY_ICON, Icon } from '../hud/icons';
import { Gauge, Tag, fmtSecs } from '../hud/primitives';
import type { RaidLike, RaidView } from '../view';

type Lx = (ja: string, en: string) => string;

export interface InstrumentProps {
  raid: RaidLike;
  view: RaidView;
  options: ChoiceOption[];
  chosenKey: string | null;
  onPick: (key: string) => void;
  gameNow: number;
  L: Lx;
  disabled?: boolean;
}

function Rec({ L }: { L: Lx }) {
  return <Tag tone="act">{L('推奨', 'REC')}</Tag>;
}

/** Gunner: hostile tracks with their integrity and the weak points to aim at. */
export function GunnerInstruments({
  raid,
  options,
  chosenKey,
  onPick,
  L,
  disabled,
}: InstrumentProps) {
  const byEnemy = new Map<number, ChoiceOption[]>();
  let charge: ChoiceOption | null = null;
  for (const o of options) {
    if ('enemyId' in o.choice && o.choice.enemyId !== undefined) {
      const list = byEnemy.get(o.choice.enemyId) ?? [];
      list.push(o);
      byEnemy.set(o.choice.enemyId, list);
    } else charge = o;
  }
  return (
    <div
      className="hud-designator"
      role="radiogroup"
      aria-label={L('目標指示', 'Target designation')}
    >
      {[...byEnemy.entries()].map(([id, opts]) => {
        const e = raid.enemies.find((x) => x.id === id);
        if (!e) return null;
        return (
          <div key={id} className={`hud-track${e.ai === 'TELEGRAPH' ? ' is-attacking' : ''}`}>
            <div className="hud-track-head">
              <Icon name={ENEMY_ICON[e.kind]} size={16} />
              <b>{L(ENEMY_LABELS[e.kind].ja, ENEMY_LABELS[e.kind].en)}</b>
              {e.ai === 'TELEGRAPH' && <Tag tone="danger">{L('攻撃準備中', 'CHARGING')}</Tag>}
              <Gauge
                value={e.hp}
                max={e.hpMax}
                tone="danger"
                segments={12}
                size="sm"
                label={L('耐久', 'Integrity')}
              />
            </div>
            <div className="hud-track-points">
              {opts.map((o) => {
                const wp = 'weakpoint' in o.choice ? o.choice.weakpoint : undefined;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={chosenKey === o.key}
                    className={`hud-choice${chosenKey === o.key ? ' is-on' : ''}`}
                    onClick={() => onPick(o.key)}
                    disabled={disabled}
                    data-testid={`choice-${o.key}`}
                  >
                    <span className="hud-choice-name">
                      {wp ? L(WEAKPOINT_LABELS[wp].ja, WEAKPOINT_LABELS[wp].en) : o.label}
                    </span>
                    {o.hint && <small>{o.hint}</small>}
                    {options[0]?.key === o.key && <Rec L={L} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {charge && (
        <button
          type="button"
          role="radio"
          aria-checked={chosenKey === charge.key}
          className={`hud-choice hud-choice-wide${chosenKey === charge.key ? ' is-on' : ''}`}
          onClick={() => onPick(charge!.key)}
          disabled={disabled}
        >
          <Icon name="energy" size={16} />
          <span className="hud-choice-name">{charge.label}</span>
          {charge.hint && <small>{charge.hint}</small>}
          <Rec L={L} />
        </button>
      )}
      {!options.length && (
        <p className="hud-empty">{L('射撃可能な目標なし', 'No target in range')}</p>
      )}
    </div>
  );
}

const SECTOR_ANGLE: Record<Direction, number> = { LEFT: -60, UP: 0, RIGHT: 60 };

/** Guardian: where attacks come from (radar) and which city to shield. */
export function GuardianInstruments({
  raid,
  view,
  options,
  chosenKey,
  onPick,
  gameNow,
  L,
  disabled,
}: InstrumentProps) {
  const bySector = Object.fromEntries(DIRECTIONS.map((d) => [d, [] as number[]])) as Record<
    Direction,
    number[]
  >;
  for (const t of raid.telegraphs)
    bySector[t.direction].push(Math.max(0, (t.resolvesAt - gameNow) / 1000));
  const cityOf = (o: ChoiceOption): RegionId | null =>
    'cityId' in o.choice ? (o.choice.cityId ?? null) : null;
  return (
    <div className="hud-instrument-row">
      <svg
        className="hud-radar hud-radar-mini"
        viewBox="0 30 200 110"
        role="img"
        aria-label={L('攻撃方向レーダー', 'Attack direction radar')}
      >
        <path d="M14,100 A86,86 0 0 1 186,100" className="hud-radar-arc" />
        {DIRECTIONS.map((d) => {
          const list = bySector[d];
          const a = ((SECTOR_ANGLE[d] - 90) * Math.PI) / 180;
          const x = 100 + Math.cos(a) * 64;
          const y = 100 + Math.sin(a) * 64;
          return (
            <g key={d} className={`hud-radar-blip${list.length ? ' is-hot' : ''}`}>
              <path d={`M${x},${y - 9} L${x + 9},${y} L${x},${y + 9} L${x - 9},${y} Z`} />
              {list.length > 0 && (
                <text x={x} y={y - 14} textAnchor="middle" className="hud-num">
                  {fmtSecs(Math.min(...list))}
                </text>
              )}
            </g>
          );
        })}
        <path d="M92,100 L100,84 L108,100 Z" className="hud-radar-own" />
      </svg>
      <div
        className="hud-designator"
        role="radiogroup"
        aria-label={L('防衛する都市', 'City to shield')}
      >
        {options.map((o, i) => {
          const id = cityOf(o);
          const c = id ? view.cities[id] : null;
          const t = id ? view.threats[id] : undefined;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={chosenKey === o.key}
              className={`hud-choice hud-choice-city${chosenKey === o.key ? ' is-on' : ''}${t?.lethal ? ' is-lethal' : ''}`}
              onClick={() => onPick(o.key)}
              disabled={disabled}
              data-testid={`choice-${o.key}`}
            >
              <span className="hud-choice-name">
                <Icon name="city" size={14} />
                {o.label}
              </span>
              {c && (
                <span className="hud-choice-stats hud-num">
                  {Math.round(c.hp)}
                  <span className="hud-choice-shield">+{Math.round(c.shield)}</span>
                </span>
              )}
              {t ? (
                <Tag tone="danger">
                  {t.lethal ? L('陥落危険', 'LETHAL') : L('被弾', 'INBOUND')} {fmtSecs(t.seconds)}
                </Tag>
              ) : (
                o.hint && <small>{o.hint}</small>
              )}
              {i === 0 && <Rec L={L} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FEED_Y: Record<EnergySink, number> = { RAIJIN: 22, FUJIN: 62, RESERVE: 102 };

/** Router: the power bus with live levels for Raijin, Fujin and the reserve, and the jam state. */
export function RouterInstruments({
  raid,
  options,
  chosenKey,
  onPick,
  gameNow,
  L,
  disabled,
}: InstrumentProps) {
  const jammed = raid.jammedUntil > gameNow;
  const level: Record<EnergySink, number> = {
    RAIJIN: raid.robots[0]!.energy,
    FUJIN: raid.robots[1]!.energy,
    RESERVE: raid.reserveEnergy,
  };
  const recKey = options[0]?.key;
  return (
    <div className="hud-instrument-row">
      <svg
        className="hud-bus"
        viewBox="0 0 120 124"
        role="img"
        aria-label={L('配電系統', 'Power bus')}
      >
        <rect x="2" y="54" width="18" height="16" className="hud-bus-src" />
        <text x="11" y="65" textAnchor="middle" className="hud-bus-txt">
          PWR
        </text>
        <path d={`M20,62 H44`} className={`hud-bus-line${jammed ? ' is-jammed' : ''}`} />
        <path d="M44,22 V102" className={`hud-bus-line${jammed ? ' is-jammed' : ''}`} />
        {(Object.keys(FEED_Y) as EnergySink[]).map((s) => (
          <path
            key={s}
            d={`M44,${FEED_Y[s]} H96`}
            className={`hud-bus-line${options.find((o) => o.key === s)?.key === chosenKey ? ' is-on' : ''}`}
          />
        ))}
        {jammed && (
          <text x="30" y="50" textAnchor="middle" className="hud-bus-jam">
            JAM
          </text>
        )}
      </svg>
      <div className="hud-designator hud-feeds" role="radiogroup" aria-label={L('送電先', 'Feed')}>
        {(['RAIJIN', 'FUJIN', 'RESERVE'] as const).map((s) => {
          const o = options.find((x) => x.key === s);
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={chosenKey === s}
              className={`hud-choice hud-feed${chosenKey === s ? ' is-on' : ''}`}
              onClick={() => o && onPick(s)}
              disabled={disabled || !o}
              data-testid={`choice-${s}`}
            >
              <span className="hud-choice-name">
                <Icon
                  name={s === 'RAIJIN' ? 'raijin' : s === 'FUJIN' ? 'fujin' : 'reserve'}
                  size={14}
                />
                {L(SINK_LABELS[s].ja, SINK_LABELS[s].en)}
              </span>
              <Gauge
                value={level[s]}
                tone={s === 'RAIJIN' ? 'raijin' : s === 'FUJIN' ? 'fujin' : 'info'}
                segments={10}
                size="sm"
                marker={s === 'RESERVE' ? raid.config.special.energyMinimum : undefined}
                label={L(`${SINK_LABELS[s].ja}の電力`, `${SINK_LABELS[s].en} energy`)}
              />
              <small>{L(SINK_LABELS[s].hintJa, SINK_LABELS[s].hintEn)}</small>
              {recKey === s && <Rec L={L} />}
            </button>
          );
        })}
        {jammed && (
          <p className="hud-inline-warn" role="status">
            <Icon name="jam" size={14} />
            {L(
              `電力妨害中 ${fmtSecs((raid.jammedUntil - gameNow) / 1000)}秒 — 整備席が解除できる`,
              `Power jammed ${fmtSecs((raid.jammedUntil - gameNow) / 1000)}s — engineers can clear it`,
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/** Damage stages follow the robots' hull (same thresholds as the 3D cracks: 70 / 40). */
function stageOf(health: number): 0 | 1 | 2 {
  return health < 40 ? 2 : health < 70 ? 1 : 0;
}

/** A front-view mech schematic whose zones show the robot's real damage state. */
function RobotSchematic({
  robot,
  L,
  selected,
  onClick,
  disabled,
}: {
  robot: RobotState;
  L: Lx;
  selected: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const raijin = robot.robotId === 'RAIJIN';
  const st = stageOf(robot.health);
  const hullTone = st === 2 ? 'danger' : st === 1 ? 'act' : 'info';
  const name = raijin ? L('雷神', 'RAIJIN') : L('風神', 'FUJIN');
  const body = (
    <>
      <svg viewBox="0 0 80 100" className={`hud-schematic hud-tone-${hullTone}`} aria-hidden="true">
        {/* back unit: thunder drum ring / wind ring */}
        <circle
          cx="40"
          cy="30"
          r={raijin ? 24 : 27}
          className={`hud-sch-back${robot.componentDamaged ? ' is-bad' : ''}`}
        />
        <rect x="33" y="8" width="14" height="11" className="hud-sch-part" />
        <path
          d={raijin ? 'M22,22 H58 L62,52 H18 Z' : 'M26,22 H54 L57,50 H23 Z'}
          className="hud-sch-hull"
        />
        <path
          d={
            raijin
              ? 'M10,24 H21 V54 H10 Z M59,24 H70 V54 H59 Z'
              : 'M14,24 H24 V52 H14 Z M56,24 H66 V52 H56 Z'
          }
          className="hud-sch-part"
        />
        <path
          d={
            raijin
              ? 'M24,54 H38 V94 H22 Z M42,54 H56 L58,94 H42 Z'
              : 'M27,52 H38 V96 H28 Z M42,52 H53 L52,96 H42 Z'
          }
          className="hud-sch-part"
        />
        {st >= 1 && <path d="M34,26 L38,34 L33,40 L37,47" className="hud-sch-crack" />}
        {st >= 2 && (
          <path d="M46,28 L50,36 M24,30 L30,26 M52,40 L57,44" className="hud-sch-crack" />
        )}
      </svg>
      <span className="hud-sch-cap">
        <b>{name}</b>
        <span className="hud-num">{Math.round(robot.health)}%</span>
      </span>
      <span className="hud-sch-flags">
        {robot.componentDamaged && (
          <Tag tone="danger">{raijin ? L('雷鼓', 'DRUM') : L('風環', 'RING')}</Tag>
        )}
        {st === 1 && <Tag tone="act">{L('亀裂', 'CRACKED')}</Tag>}
        {st === 2 && <Tag tone="danger">{L('装甲破損', 'BREACH')}</Tag>}
      </span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`hud-sch-card${selected ? ' is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={L(`${name}を修理`, `Repair ${name}`)}
    >
      {body}
    </button>
  ) : (
    <div className="hud-sch-card is-static">{body}</div>
  );
}

/** Engineer: both robots' damage state, the power jam and the cities to rebuild. */
export function EngineerInstruments({
  raid,
  view,
  options,
  chosenKey,
  onPick,
  gameNow,
  L,
  disabled,
}: InstrumentProps) {
  const robotOpt = (id: 'RAIJIN' | 'FUJIN') =>
    options.find(
      (o) =>
        'repair' in o.choice && o.choice.repair?.type === 'ROBOT' && o.choice.repair.robot === id,
    );
  const unjam = options.find((o) => 'repair' in o.choice && o.choice.repair?.type === 'UNJAM');
  const cityOpts = options.filter((o) => 'repair' in o.choice && o.choice.repair?.type === 'CITY');
  const jammed = raid.jammedUntil > gameNow;
  const recKey = options[0]?.key;
  return (
    <div
      className="hud-instrument-row"
      role="radiogroup"
      aria-label={L('修理対象', 'Repair target')}
    >
      <div className="hud-sch-pair">
        {raid.robots.map((r) => {
          const o = robotOpt(r.robotId as 'RAIJIN' | 'FUJIN');
          return (
            <div key={r.robotId} className="hud-sch-slot">
              <RobotSchematic
                robot={r}
                L={L}
                selected={!!o && chosenKey === o.key}
                onClick={o ? () => onPick(o.key) : undefined}
                disabled={disabled}
              />
              {o && recKey === o.key && <Rec L={L} />}
            </div>
          );
        })}
      </div>
      <div className="hud-designator">
        <div className={`hud-sys-row${jammed ? ' is-bad' : ''}`}>
          <Icon name="jam" size={14} />
          <span>{L('配電系統', 'Power bus')}</span>
          <b>
            {jammed
              ? L(
                  `妨害 ${fmtSecs((raid.jammedUntil - gameNow) / 1000)}s`,
                  `JAMMED ${fmtSecs((raid.jammedUntil - gameNow) / 1000)}s`,
                )
              : L('正常', 'NOMINAL')}
          </b>
          {unjam && (
            <button
              type="button"
              role="radio"
              aria-checked={chosenKey === unjam.key}
              className={`hud-choice hud-choice-inline${chosenKey === unjam.key ? ' is-on' : ''}`}
              onClick={() => onPick(unjam.key)}
              disabled={disabled}
            >
              {unjam.label}
              {recKey === unjam.key && <Rec L={L} />}
            </button>
          )}
        </div>
        {cityOpts.map((o) => {
          const id =
            'repair' in o.choice && o.choice.repair?.type === 'CITY'
              ? o.choice.repair.cityId
              : null;
          const c = id ? view.cities[id] : null;
          const wait =
            c && c.destroyed && c.rebuildReadyAt > gameNow
              ? (c.rebuildReadyAt - gameNow) / 1000
              : 0;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={chosenKey === o.key}
              className={`hud-choice hud-choice-city${chosenKey === o.key ? ' is-on' : ''}${c?.destroyed ? ' is-down' : ''}`}
              onClick={() => onPick(o.key)}
              disabled={disabled}
              data-testid={`choice-${o.key}`}
            >
              <span className="hud-choice-name">
                <Icon name="city" size={14} />
                {id ? cityName(id, L) : o.label}
              </span>
              {c &&
                (c.destroyed ? (
                  <Tag tone="danger">
                    {wait > 0
                      ? L(`再建待ち ${fmtSecs(wait)}`, `REBUILD ${fmtSecs(wait)}`)
                      : L('再建', 'REBUILD')}
                  </Tag>
                ) : (
                  <Gauge
                    value={c.hp}
                    max={raid.config.cityMaxHp}
                    tone={c.hp < raid.config.cityMaxHp * 0.5 ? 'act' : 'info'}
                    segments={10}
                    size="sm"
                    label={L('都市の耐久', 'City HP')}
                  />
                ))}
              {recKey === o.key && <Rec L={L} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
