import {
  IsString,
  IsOptional,
  IsIn,
  ValidateNested,
  IsUUID,
  IsBoolean,
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
}
