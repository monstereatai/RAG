export type RagMcpErrorCode =
  | 'invalid_args'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'service_unavailable'
  | 'server_error'
  | 'unknown_error';

export class RagMcpError extends Error {
  readonly code: RagMcpErrorCode;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(
    code: RagMcpErrorCode,
    message: string,
    options: { recoverable?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'RagMcpError';
    this.code = code;
    this.recoverable =
      options.recoverable ?? ['invalid_args', 'not_found', 'service_unavailable'].includes(code);
    this.details = options.details;
  }
}

export function toRagMcpError(error: unknown): RagMcpError {
  if (error instanceof RagMcpError) {
    return error;
  }
  if (error instanceof Error) {
    return new RagMcpError('unknown_error', error.message, { recoverable: false });
  }
  return new RagMcpError('unknown_error', 'unknown error', { recoverable: false });
}
