import { ExitCode } from './exit-code.js';
import type { ExitCodeValue } from './exit-code.js';

export type CliErrorCode =
  | 'invalid_args'
  | 'unauthorized'
  | 'forbidden'
  | 'service_unavailable'
  | 'server_error'
  | 'insufficient_context'
  | 'not_found'
  | 'unknown_error';

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: ExitCodeValue;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(
    code: CliErrorCode,
    message: string,
    options: {
      exitCode?: ExitCodeValue;
      recoverable?: boolean;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = options.exitCode ?? defaultExitCode(code);
    this.recoverable = options.recoverable ?? this.exitCode === ExitCode.Recoverable;
    this.details = options.details;
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (isZodLikeError(error)) {
    return new CliError('invalid_args', error.issues.map((issue) => issue.message).join(', '), {
      exitCode: ExitCode.InvalidArgs,
      recoverable: true,
      details: error.issues,
    });
  }
  if (error instanceof Error) {
    return new CliError('unknown_error', error.message, {
      exitCode: ExitCode.ServerError,
      recoverable: false,
    });
  }
  return new CliError('unknown_error', 'unknown error', {
    exitCode: ExitCode.ServerError,
    recoverable: false,
  });
}

function isZodLikeError(
  error: unknown,
): error is { issues: Array<{ message: string }> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function defaultExitCode(code: CliErrorCode): ExitCodeValue {
  switch (code) {
    case 'invalid_args':
      return ExitCode.InvalidArgs;
    case 'unauthorized':
    case 'forbidden':
      return ExitCode.Unauthorized;
    case 'server_error':
      return ExitCode.ServerError;
    case 'insufficient_context':
    case 'service_unavailable':
    case 'not_found':
    case 'unknown_error':
      return ExitCode.Recoverable;
  }
}
