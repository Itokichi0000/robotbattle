import { useState } from 'react';
import type { Role, TaskInput, TaskParams } from '@sats-wars/shared';
import { ROLES, ROLE_LABELS } from '@sats-wars/shared';
import { engineerParams, evaluateTask, guardianParams, gunnerParams, randomDirection, routerParams } from '@sats-wars/game-engine';
import { successLabel } from './board';
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
 * Practice any seat while waiting. Runs entirely on this device and changes
 * nothing in the raid (no server call, no effect, no score).
 */
export function TrainingPanel({ locale, initialRole = 'GUNNER' }: { locale: 'ja' | 'en'; initialRole?: Role }) {
  const L = (ja: string, en: string) => (locale === 'ja' ? ja : en);
  const [role, setRole] = useState<Role>(initialRole);
  const [round, setRound] = useState(0);
  const [params, setParams] = useState<TaskParams>(() => practiceParams(initialRole));
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [last, setLast] = useState<string | null>(null);
  const next = (r: Role) => {
    setRole(r);
    setParams(practiceParams(r));
    setStartedAt(performance.now());
    setRound((x) => x + 1);
  };
  const onSubmit = (input: TaskInput) => {
    const ev = evaluateTask(params, input, performance.now() - startedAt, 60_000);
    setLast(ev.valid ? successLabel(ev.success, L) : L('もう一度！', 'Again!'));
    setTimeout(() => next(role), 900);
  };
  return (
    <section className="swc-training" data-testid="training">
      <h3 className="swc-h">{L('練習モード（本番には影響しません）', 'Practice (does not affect the raid)')}</h3>
      <div className="swc-tabs" role="tablist">
        {ROLES.map((r) => (
          <button key={r} type="button" role="tab" aria-selected={role === r} className={`swc-tab${role === r ? ' is-on' : ''}`} onClick={() => next(r)}>
            {ROLE_LABELS[r].icon} {L(ROLE_LABELS[r].ja, ROLE_LABELS[r].en)}
          </button>
        ))}
      </div>
      <Minigame key={round} task={{ params }} locale={locale} onSubmit={onSubmit} />
      {last && (
        <p className="swc-result is-good" role="status">
          {last}
        </p>
      )}
    </section>
  );
}
