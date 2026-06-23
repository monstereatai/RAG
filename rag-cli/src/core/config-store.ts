import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface CliConfig {
  baseUrl?: string;
  token?: string;
}

export interface RuntimeConfig {
  baseUrl: string;
  token?: string;
  configPath: string;
  tokenSource: 'option' | 'env' | 'config' | 'none';
}

const defaultBaseUrl = 'http://localhost:3000/api/v1';

export class ConfigStore {
  constructor(private readonly configPath = defaultConfigPath()) {}

  path(): string {
    return this.configPath;
  }

  async load(): Promise<CliConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      return JSON.parse(raw) as CliConfig;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async save(config: CliConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(this.configPath, 0o600);
  }

  async update(patch: CliConfig): Promise<CliConfig> {
    const current = await this.load();
    const next = { ...current, ...patch };
    await this.save(next);
    return next;
  }

  async clearToken(): Promise<CliConfig> {
    const current = await this.load();
    const next = { ...current };
    delete next.token;
    await this.save(next);
    return next;
  }

  async remove(): Promise<void> {
    await rm(this.configPath, { force: true });
  }

  async resolve(options: { baseUrl?: string; token?: string } = {}): Promise<RuntimeConfig> {
    const fileConfig = await this.load();
    const token = options.token ?? process.env.RAG_TOKEN ?? fileConfig.token;
    const tokenSource = options.token
      ? 'option'
      : process.env.RAG_TOKEN
        ? 'env'
        : fileConfig.token
          ? 'config'
          : 'none';

    return {
      baseUrl: normalizeBaseUrl(options.baseUrl ?? process.env.RAG_BASE_URL ?? fileConfig.baseUrl ?? defaultBaseUrl),
      token,
      configPath: this.configPath,
      tokenSource,
    };
  }
}

export function defaultConfigPath(): string {
  return join(homedir(), '.config', 'rag-cli', 'config.json');
}

export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

