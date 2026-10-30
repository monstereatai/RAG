export const WORKSPACE_ROOT = '/root/workspace';

export const WORKSPACE_TTL_SECONDS = 6 * 60 * 60;

export const PREVIEW_TICKET_TTL_SECONDS = 5 * 60;

export const MAX_COMMAND_LENGTH = 4096;

export const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024;

export const MAX_DEV_COMMAND_LENGTH = 1024;

export const MAX_SEED_ZIP_BYTES = 25 * 1024 * 1024;

export const MAX_SEED_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export const MAX_SEED_FILES = 1500;

export const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;

export const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

export const MAX_PROXY_RESPONSE_BYTES = 25 * 1024 * 1024;

export const DEV_SERVER_READY_TIMEOUT_MS = 20_000;

export const DEV_SERVER_READY_INTERVAL_MS = 500;

export const WORKSPACE_LOCK_TTL_SECONDS = 300;

export const WORKSPACE_LOCK_WAIT_MS = 30_000;

export const WORKSPACE_LOCK_RETRY_MS = 100;

export const PREVIEW_UPSTREAM_TIMEOUT_MS = 45_000;

export interface WorkspaceRecord {
  version: 1;
  tenantId: string | null;
  ownerUserId: string;
  threadId: string;
  sandboxId: string;
  artifactId: string;
  createdAt: string;
  expiresAt: number;
  devServer: null | {
    commandId: string;
    port: number;
    startedAt: string;
  };
}

export interface PreviewTicketRecord {
  version: 1;
  workspaceKey: string;
  tenantId: string | null;
  ownerUserId: string;
  threadId: string;
  sandboxId: string;
  port: number;
  expiresAt: number;
}

export interface SandboxCommandOutput {
  logs?: {
    stdout?: Array<{ text?: string }>;
    stderr?: Array<{ text?: string }>;
  };
  error?: { value?: string };
  exitCode?: number | null;
  id?: string;
}
