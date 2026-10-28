import type { RobotId, Role, SubmitResponse, TaskInput, TaskResponse } from '@sats-wars/shared';
import type { TaskChoice } from '@sats-wars/game-engine';

/**
 * What the cockpit needs from "the server". The web app implements it with
 * HTTP calls; the offline demo implements it with the engine in the browser.
 * Every effect is computed on the other side: the cockpit only sends a seat,
 * a target choice and raw minigame input.
 */
export interface RaidClient {
  board(role: Role, robot?: RobotId): Promise<void>;
  changeRole(role: Role, robot?: RobotId): Promise<void>;
  requestTask(choice: TaskChoice): Promise<TaskResponse>;
  submitTask(taskId: string, input: TaskInput, clientSubmissionId: string): Promise<SubmitResponse>;
  /** Estimated current raid game time (ms). */
  gameNow(): number;
}

/** Error with a user-facing message (already localised by the server). */
export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export function newSubmissionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
