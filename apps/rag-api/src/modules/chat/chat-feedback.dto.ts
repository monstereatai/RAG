import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ChatFeedbackDto {
  @IsOptional()
  @IsUUID()
  queryLogId?: string;

  @IsOptional()
  @IsUUID()
  threadId?: string;

  @IsIn(['positive', 'negative'])
  feedback!: 'positive' | 'negative';

  @IsOptional()
  @IsIn([
    'retrieval_miss',
    'ranking_error',
    'citation_error',
    'hallucination',
    'outdated_content',
    'incomplete_answer',
    'other',
  ])
  errorType?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  correctedAnswer?: string;

  @IsOptional()
  @IsBoolean()
  includeInRegression?: boolean;
}
