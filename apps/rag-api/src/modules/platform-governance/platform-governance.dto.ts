import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateGovernanceWorkflowDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @IsDefined()
  @IsObject()
  definition!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  workspaceId?: string;
}

export class PublishGovernanceWorkflowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version!: number;
}

export class CloneGovernanceWorkflowDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
  key!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;
}

export class ResolvePluginCompositionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9._-]{2,127}$/, { each: true })
  pluginKeys?: string[];

  @IsOptional()
  @IsIn(['simple', 'auto', 'agentic', 'production'])
  mode?: 'simple' | 'auto' | 'agentic' | 'production';
}

const PLUGIN_TYPES = [
  'model',
  'tool',
  'mcp',
  'datasource',
  'agent_strategy',
  'trigger',
] as const;

const PLUGIN_MODES = ['simple', 'auto', 'agentic', 'production'] as const;

export class RegisterGovernancePluginDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]{2,127}$/)
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsOptional()
  @IsIn(PLUGIN_TYPES)
  type?: (typeof PLUGIN_TYPES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  capabilities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  permissions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  tools?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(PLUGIN_MODES, { each: true })
  modes?: Array<(typeof PLUGIN_MODES)[number]>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  requires?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(128)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  conflicts?: string[];

  @IsOptional()
  @IsIn(['enabled', 'disabled', 'degraded'])
  status?: 'enabled' | 'disabled' | 'degraded';
}

export class GovernancePluginStatusDto {
  @IsIn(['enabled', 'disabled', 'degraded'])
  status!: 'enabled' | 'disabled' | 'degraded';
}

export class RegisterGovernanceModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  model!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsObject()
  pricing?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  fallbackModel?: string;
}

export class CreateGovernanceEvaluationCaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  query!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  expectedAnswer!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  expectedReferences?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sourceFeedbackId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  workspaceId?: string;
}

export class RegisterKnowledgeBaseProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  workspaceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  documentType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(4_000)
  chunkSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_999)
  chunkOverlap?: number;

  @IsOptional()
  @IsObject()
  retrievalConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  syncConfig?: Record<string, unknown>;
}
