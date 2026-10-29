import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RagMcpConfig {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  timeoutMs: number;
  defaultLimit: number;
  configPath: string;
  tokenSource: 'api-key-env' | 'env' | 'rag-cli-config' | 'auto-login-env' | 'none';
}

interface CliConfig {
  baseUrl?: string;
  token?: string;
}

const defaultBaseUrl = 'http://localhost:3000/api/v1';
const defaultTimeoutMs = 15000;
const defaultLimit = 5;

export async function loadConfig(): Promise<RagMcpConfig> {
  const configPath = defaultCliConfigPath();
  const cliConfig = await loadCliConfig(configPath);
  const envBaseUrl = process.env.RAG_MCP_BASE_URL ?? process.env.RAG_BASE_URL;
  const envApiKey = process.env.RAG_MCP_API_KEY ?? process.env.RAG_API_KEY;
  const envToken = process.env.RAG_MCP_TOKEN ?? process.env.RAG_TOKEN;
  const username = process.env.RAG_MCP_USERNAME ?? process.env.RAG_USERNAME;
  const password = process.env.RAG_MCP_PASSWORD ?? process.env.RAG_PASSWORD;
  const timeoutMs = readPositiveInt(process.env.RAG_MCP_TIMEOUT_MS, defaultTimeoutMs);
  const limit = readPositiveInt(process.env.RAG_MCP_DEFAULT_LIMIT, defaultLimit);
  const tokenSource = envApiKey
    ? 'api-key-env'
    : envToken
      ? 'env'
      : cliConfig.token
      ? 'rag-cli-config'
      : username && password
        ? 'auto-login-env'
        : 'none';

  return {
    baseUrl: normalizeBaseUrl(envBaseUrl ?? cliConfig.baseUrl ?? defaultBaseUrl),
    token: envApiKey ?? envToken ?? cliConfig.token,
    apiKey: envApiKey,
    username,
    password,
    timeoutMs,
    defaultLimit: limit,
    configPath,
    tokenSource,
  };
}

export function defaultCliConfigPath(): string {
  return join(homedir(), '.config', 'rag-cli', 'config.json');
}

export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

async function loadCliConfig(configPath: string): Promise<CliConfig> {
  try {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as CliConfig;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
