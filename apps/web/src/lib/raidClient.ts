import type { RobotId, Role, SubmitResponse, TaskInput, TaskResponse } from '@sats-wars/shared';
import type { TaskChoice } from '@sats-wars/game-engine';
import { ClientError, type RaidClient } from '@sats-wars/ui';
import { ApiError, api } from './api';
import type { RaidConnection } from './connection';

/** The cockpit's server: plain HTTP calls with the pilot's session cookie. */
export function httpRaidClient(conn: RaidConnection): RaidClient {
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    try {
      return await api<T>(path, { body });
    } catch (e) {
      if (e instanceof ApiError) throw new ClientError(e.code, e.message, e.status);
      throw e;
    }
  };
  return {
    board: async (role: Role, robot?: RobotId) => {
      await call('/api/raids/current/board', { role, ...(robot ? { robot } : {}) });
    },
    changeRole: async (role: Role, robot?: RobotId) => {
      await call('/api/raids/current/change-role', { role, ...(robot ? { robot } : {}) });
    },
    requestTask: (choice: TaskChoice) => call<TaskResponse>('/api/raids/current/tasks', choice),
    submitTask: (taskId: string, input: TaskInput, clientSubmissionId: string) =>
      call<SubmitResponse>('/api/raids/current/tasks/submit', { taskId, clientSubmissionId, input }),
    gameNow: conn.gameNow,
  };
}
