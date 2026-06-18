import {
  IsString,
  IsOptional,
  IsIn,
  ValidateNested,
  IsUUID,
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

export class ChatDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsIn(['simple', 'agentic', 'auto'])
  mode?: ChatMode;

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
}

export interface ChatReference {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  totalScore: number;
  bm25Score: number;
  cosineScore: number;
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
}
