import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StartProductionProjectWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  artifactId!: string;

  @IsOptional()
  @IsIn(['frontend', 'backend', 'qa'])
  role?: 'frontend' | 'backend' | 'qa';
}

export class RunProductionProjectWorkspaceCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  command!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  timeoutSeconds?: number;
}

export class StartProductionProjectWorkspaceDevServerDto {
  @IsInt()
  @Min(1024)
  @Max(65535)
  port!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  command?: string;
}

export class CreateProductionProjectWorkspacePreviewTicketDto {
  @IsInt()
  @Min(1024)
  @Max(65535)
  port!: number;
}

export class DestroyProductionProjectWorkspaceDto {
  @Equals(true)
  confirmDiscard!: true;
}

export class RunProductionProjectWorkspaceAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  artifactId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  instruction!: string;
}

export class SubmitWorkspaceCodingTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  artifactId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  instruction!: string;

  @IsUUID()
  requestId!: string;

  @IsOptional()
  @IsIn(['frontend', 'backend', 'qa'])
  role?: 'frontend' | 'backend' | 'qa';

  @IsOptional()
  @IsIn(['code', 'verify'])
  task?: 'code' | 'verify';
}

export class ReviewWorkspaceCodingTaskDto {
  @IsUUID()
  reviewId!: string;

  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsUUID()
  remediationTaskId?: string;
}

export interface WorkspaceCommandResult {
  command: string;
  output: string;
  outputTruncated: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export interface WorkspaceStatus {
  ready: boolean;
  projectRoot: string | null;
  active: boolean;
  expired?: boolean;
  artifactId?: string;
  createdAt?: string;
  devServer?: {
    port: number;
    commandId: string;
    startedAt: string;
  };
}

export interface StartDevServerInput {
  port: number;
  command?: string;
}

export interface WorkspaceDevServerStatus {
  status: 'running';
  port: number;
  commandId: string;
  startedAt: string;
}

export interface WorkspacePreviewTicket {
  ticket: string;
  expiresInSeconds: number;
}

export interface WorkspacePreviewRequest {
  method: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  query?: string;
  path: string;
  signal?: AbortSignal;
}

export interface WorkspaceProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
