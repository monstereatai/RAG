import { IsString, IsOptional, IsIn, ValidateNested } from 'class-validator';
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

  /** 多轮对话历史（可选，前端传入，按时间顺序） */
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
}
