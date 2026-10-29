export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NO_RAID'
  | 'PASS_REQUIRED'
  | 'JOIN_CLOSED'
  | 'ALREADY_ENTITLED'
  | 'PAYMENTS_DISABLED'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'INVALID_PASS'
  | 'NOT_MOCK_MODE'
  | 'INVALID_COMMAND'
  | 'CONFLICT'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  NO_RAID: 409,
  PASS_REQUIRED: 402,
  JOIN_CLOSED: 409,
  ALREADY_ENTITLED: 409,
  PAYMENTS_DISABLED: 503,
  PAYMENT_PROVIDER_ERROR: 502,
  INVALID_PASS: 400,
  NOT_MOCK_MODE: 404,
  INVALID_COMMAND: 409,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Error with a stable machine code; message is safe to show to users. */
export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.statusCode = STATUS[code];
  }
}
