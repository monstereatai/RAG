import chalk from 'chalk';

export interface TerminalMode {
  format: string;
  quiet?: boolean;
}

export function isMachineMode(options: TerminalMode): boolean {
  return (
    options.format === 'json' ||
    options.quiet === true ||
    process.env.CI === 'true' ||
    !process.stdout.isTTY
  );
}

export function statusSymbol(kind: 'ok' | 'warn' | 'error', machine: boolean): string {
  if (machine) {
    return kind.toUpperCase();
  }
  if (kind === 'ok') return chalk.green('OK');
  if (kind === 'warn') return chalk.yellow('WARN');
  return chalk.red('ERROR');
}

export function heading(text: string, machine: boolean): string {
  return machine ? text : chalk.bold(text);
}

