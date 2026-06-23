import { CliError } from './errors.js';
import { heading, isMachineMode, statusSymbol } from './terminal.js';
import type { OutputFormat } from './schemas.js';

export interface OutputEnvelope<T> {
  status: 'ok' | 'insufficient_context' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

export class OutputFormatter {
  constructor(
    private readonly format: OutputFormat,
    private readonly quiet = false,
  ) {}

  write<T>(envelope: OutputEnvelope<T>): void {
    if (this.format === 'json') {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (this.format === 'table') {
      this.writeTable(envelope);
      return;
    }

    this.writeMarkdown(envelope);
  }

  error(error: CliError): void {
    this.write({
      status: error.code === 'insufficient_context' ? 'insufficient_context' : 'error',
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        details: error.details,
      },
    });
  }

  private writeMarkdown<T>(envelope: OutputEnvelope<T>): void {
    if (envelope.status === 'error' || envelope.status === 'insufficient_context') {
      const error = envelope.error;
      process.stdout.write(
        `${statusSymbol(envelope.status === 'error' ? 'error' : 'warn', isMachineMode({ format: this.format, quiet: this.quiet }))} ${error?.message ?? envelope.status}\n`,
      );
      return;
    }

    const data = envelope.data;
    if (typeof data === 'string') {
      process.stdout.write(`${data}\n`);
      return;
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        process.stdout.write(`- ${this.stringifyShort(item)}\n`);
      }
      return;
    }
    if (data && typeof data === 'object') {
      process.stdout.write(`${heading('Result', false)}\n\n`);
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${statusSymbol('ok', false)}\n`);
  }

  private writeTable<T>(envelope: OutputEnvelope<T>): void {
    if (envelope.status !== 'ok') {
      this.writeMarkdown(envelope);
      return;
    }
    const data = envelope.data;
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    if (rows.length === 0) {
      process.stdout.write('No rows\n');
      return;
    }
    console.table(rows);
  }

  private stringifyShort(value: unknown): string {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return String(record.name ?? record.title ?? record.id ?? JSON.stringify(record));
    }
    return String(value);
  }
}

