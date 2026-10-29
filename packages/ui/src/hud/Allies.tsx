import type { CrewMember, RobotState } from '@sats-wars/shared';
import { Icon } from './icons';
import { Gauge, Tag, useFlash } from './primitives';

type Lx = (ja: string, en: string) => string;

/** Same thresholds as the 3D damage stages (cracks below 70, plates open below 40). */
export function hullStage(health: number): 0 | 1 | 2 {
  return health < 40 ? 2 : health < 70 ? 1 : 0;
}

/**
 * Ally status at the screen edge (spec 3.2): Raijin bottom-left, Fujin
 * bottom-right, where they stand in the 3D view. Hull, energy, the drum/ring
 * component and how many pilots fly it. A hull drop flashes the panel once.
 */
export function AllyPanel({
  robot,
  crew,
  locale,
  side,
}: {
  robot: RobotState;
  crew: CrewMember[];
  locale: 'ja' | 'en';
  side: 'left' | 'right';
}) {
  const L: Lx = (ja, en) => (locale === 'ja' ? ja : en);
  const raijin = robot.robotId === 'RAIJIN';
  const hit = useFlash(Math.round(robot.health), 650);
  const stage = hullStage(robot.health);
  const aboard = crew.filter((m) => m.robot === robot.robotId).length;
  return (
    <section
      className={`hud-ally hud-ally-${side} hud-ally-${raijin ? 'raijin' : 'fujin'}${hit ? ' is-hit' : ''}${stage === 2 ? ' is-critical' : ''}`}
      aria-label={raijin ? L('雷神の状態', 'Raijin status') : L('風神の状態', 'Fujin status')}
      data-testid={`ally-${robot.robotId}`}
    >
      <header className="hud-ally-head">
        <Icon name={raijin ? 'raijin' : 'fujin'} size={18} />
        <b>{raijin ? L('雷神', 'RAIJIN') : L('風神', 'FUJIN')}</b>
        <span
          className="hud-ally-crew hud-num"
          aria-label={L(`搭乗 ${aboard}人`, `${aboard} aboard`)}
        >
          <Icon name="crew" size={12} />
          {aboard}
        </span>
      </header>
      <div className="hud-ally-row">
        <span className="hud-label">HULL</span>
        <Gauge
          value={robot.health}
          tone={stage === 2 ? 'danger' : stage === 1 ? 'act' : 'info'}
          segments={10}
          size="sm"
          label={L('機体', 'Hull')}
          unit="%"
        />
      </div>
      <div className="hud-ally-row">
        <span className="hud-label">{raijin ? 'CHARGE' : 'POWER'}</span>
        <Gauge
          value={robot.energy}
          tone={raijin ? 'raijin' : 'fujin'}
          segments={10}
          size="sm"
          label={L('電力', 'Energy')}
        />
      </div>
      <footer className="hud-ally-flags">
        {robot.componentDamaged ? (
          <Tag tone="danger">
            {raijin ? L('雷鼓 損傷', 'DRUM DAMAGED') : L('風環 損傷', 'RING DAMAGED')}
          </Tag>
        ) : (
          <span className="hud-ally-ok">
            {raijin ? L('雷鼓 正常', 'DRUM OK') : L('風環 正常', 'RING OK')}
          </span>
        )}
        {stage === 2 && <Tag tone="danger">{L('装甲破損', 'BREACH')}</Tag>}
      </footer>
    </section>
  );
}
