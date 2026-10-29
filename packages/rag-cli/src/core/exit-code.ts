export const ExitCode = {
  Ok: 0,
  Recoverable: 1,
  InvalidArgs: 2,
  Unauthorized: 3,
  ServerError: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

