import { IsString, IsOptional, IsIn } from 'class-validator';

export class ChatDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsIn(['simple'])
  mode?: 'simple';
}

export interface ChatResponse {
  answer: string;
  references: Array<{
    id: string;
    content: string;
    docId: string;
    chunkIndex: number;
    totalScore: number;
    bm25Score: number;
    cosineScore: number;
  }>;
}
