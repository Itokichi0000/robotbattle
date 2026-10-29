import { useState } from 'react';
import type { Role, TaskInput, TaskParams } from '@sats-wars/shared';
import { ROLES, ROLE_LABELS } from '@sats-wars/shared';
import {
  engineerParams,
  evaluateTask,
  guardianParams,
  gunnerParams,
  randomDirection,
  routerParams,
} from '@sats-wars/game-engine';
import { successLabel } from './board';
import { Icon, ROLE_ICON } from './hud/icons';
import { Minigame } from './minigames';

function practiceParams(role: Role): TaskParams {
  const r = Math.random;
  switch (role) {
    case 'GUNNER':
      return gunnerParams(r, 'EASY');
    case 'GUARDIAN':
      return guardianParams(r, 'EASY', randomDirection(r));
    case 'ROUTER':
      return routerParams(r, 'NORMAL', 'RESERVE', false);
    case 'ENGINEER':
      return engineerParams(r, 'EASY');
  }
}

/**
 * The simulator: practise any station with the battle instruments while
 * waiting. Runs entirely on this device and changes nothing in the raid (no
 * server call, no effect, no score).
 */
export function TrainingPanel({
  locale,
  initialRole = 'GUNNER',
  onClose,
}: {
  locale: 'ja' | 'en';
  initialRole?: Role;
  onClose?: () => void;
}) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [role, setRole] = useState<Role>(initialRole);
  const [round, setRound] = useState(0);
  const [params, setParams] = useState<TaskParams>(() => practiceParams(initialRole));
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [last, setLast] = useState<{ text: string; good: boolean } | null>(null);
  const next = (r: Role) => {
    setRole(r);
    setParams(practiceParams(r));
    setStartedAt(performance.now());
    setRound((x) => x + 1);
  };
  const onSubmit = (input: TaskInput) => {
    const ev = evaluateTask(params, input, performance.now() - startedAt, 60_000);
    setLast(
      ev.valid
        ? { text: successLabel(ev.success, L), good: ev.success > 0 }
        : { text: L('もう一度！', 'Again!'), good: false },
    );
    setTimeout(() => next(role), 900);
  };
  return (
    <section
      className="hud-sim"
      data-testid="training"
      aria-label={L('シミュレーター', 'Simulator')}
    >
      <header className="hud-sim-head">
        <span className="hud-label">SIMULATOR</span>
        <b>{L('練習モード — 本番には影響しません', 'Practice — no effect on the raid')}</b>
        {onClose && (
          <button
            type="button"
            className="hud-icon-btn"
            onClick={onClose}
            aria-label={L('閉じる', 'Close')}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </header>
      <div className="hud-sim-tabs" role="tablist">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={role === r}
            className={`hud-sim-tab${role === r ? ' is-on' : ''}`}
            onClick={() => next(r)}
          >
            <Icon name={ROLE_ICON[r]} size={16} />
            {L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}
          </button>
        ))}
      </div>
      <div className="hud-instrument">
        <Minigame key={round} task={{ params }} locale={locale} onSubmit={onSubmit} />
      </div>
      {last && (
        <p className={`hud-result is-center ${last.good ? 'is-good' : 'is-miss'}`} role="status">
          <b>{last.text}</b>
        </p>
      )}
    </section>
  );
}
