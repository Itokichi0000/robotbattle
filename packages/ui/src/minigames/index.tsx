import type { Task, TaskInput } from '@sats-wars/shared';
import { EngineerGame } from './Engineer';
import { GuardianGame } from './Guardian';
import { GunnerGame } from './Gunner';
import { RouterGame } from './Router';

export { EngineerGame, GuardianGame, GunnerGame, RouterGame };

/** The minigame for a task's seat. `key` it by taskId so state resets per task. */
export function Minigame({
  task,
  locale,
  onSubmit,
  disabled,
  offsetMs,
}: {
  task: Pick<Task, 'params'>;
  locale: 'ja' | 'en';
  onSubmit: (i: TaskInput) => void;
  disabled?: boolean;
  offsetMs?: number;
}) {
  const p = task.params;
  const common = { locale, onSubmit, disabled, offsetMs };
  switch (p.role) {
    case 'GUNNER':
      return <GunnerGame params={p} {...common} />;
    case 'GUARDIAN':
      return <GuardianGame params={p} {...common} />;
    case 'ROUTER':
      return <RouterGame params={p} {...common} />;
    case 'ENGINEER':
      return <EngineerGame params={p} {...common} />;
  }
}
