import {
  IsString,
  IsOptional,
  IsIn,
  ValidateNested,
  IsUUID,
  IsBoolean,
  IsArray,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';

export type ChatMode = 'simple' | 'agentic' | 'auto';

/** 单条对话历史消息 */
export class ChatMessageDto {
  @IsString()
  role!: 'human' | 'ai';

  @IsString()
  content!: string;
}

export class RetrievalScopeDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  activityId?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsBoolean()
  includeDeprecated?: boolean;
}

export class ChatDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsIn(['simple', 'agentic', 'auto'])
  mode?: ChatMode;

  /** 岗位预设角色，默认 business-owner */
  @IsOptional()
  @IsString()
  rolePresetId?: string;

  /** 可选知识库配置 Key；未传时按 scope.projectId／documentType 自动匹配 */
  @IsOptional()
  @IsString()
  knowledgeBaseKey?: string;

  /**
   * 对话 threadId（可选）
   * - 不传：新建对话（返回新 threadId）
   * - 传入：追加到已有对话，注入对话历史到 LLM 上下文
   */
  @IsOptional()
  @IsUUID()
  threadId?: string;

  /** 多轮对话历史（可选，前端传入，按时间顺序；传 threadId 时服务端自动补充） */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RetrievalScopeDto)
  scope?: RetrievalScopeDto;

  /** 可选插件组合；服务端会校验链路、依赖、冲突和工具权限。 */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  pluginKeys?: string[];

  /** 仅 Agentic 路径可用：生成草稿后暂停，等待人工审批再完成收口。 */
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}

export interface ChatReference {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  totalScore: number;
  bm25Score: number;
  cosineScore: number;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  retrievalSource?: string;
  contextRole?: string;
}

export interface ChatResponse {
  answer: string;
  references: ChatReference[];
  mode?: ChatMode;
  route?: 'simple' | 'agentic';
  confidence?: number;
  retryCount?: number;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  /** 返回当前对话的 threadId（新建对话时为新生成的 ID） */
  threadId?: string;
  queryLogId?: string;
  runId?: string;
  evidenceCoverage?: Array<{
    id: string;
    query: string;
    covered: boolean;
    evidenceIds: string[];
  }>;
  executionState?: {
    phase?: 'approval' | 'completed' | 'failed';
    consumedSteps: number;
    consumedToolCalls: number;
    remainingSteps?: number;
    remainingToolCalls?: number;
    checkpointId?: string;
    paused?: boolean;
    lastNode?: string;
  };
}
