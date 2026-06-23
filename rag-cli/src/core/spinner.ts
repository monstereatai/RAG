import { isMachineMode } from './terminal.js';

export interface SpinnerOptions {
  format: string;
  quiet?: boolean;
  text: string;
}

export interface CliSpinner {
  start(): void;
  succeed(): void;
  fail(): void;
}

export function createSpinner(options: SpinnerOptions): CliSpinner | null {
  if (isMachineMode(options)) {
    return null;
  }
  return new MinimalSpinner(options.text);
}

class MinimalSpinner implements CliSpinner {
  private timer: NodeJS.Timeout | undefined;
  private frameIndex = 0;
  private readonly frames = ['-', '\\', '|', '/'];

  constructor(private readonly text: string) {}

  start(): void {
    if (!process.stderr.isTTY) {
      process.stderr.write(`${this.text}...\n`);
      return;
    }
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  succeed(): void {
    this.stop(`OK ${this.text}\n`);
  }

  fail(): void {
    this.stop(`ERROR ${this.text}\n`);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex % this.frames.length];
    this.frameIndex += 1;
    process.stderr.write(`\r${frame} ${this.text}`);
  }

  private stop(message: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (process.stderr.isTTY) {
      process.stderr.write(`\r\x1b[K${message}`);
    }
  }
}
