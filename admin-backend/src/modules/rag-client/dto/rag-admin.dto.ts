import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RagDocumentQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  sourceAuthority?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class RagEvaluationRunDto {
  @IsOptional()
  @IsString()
  dataset?: string;

  @IsOptional()
  @IsString()
  mode?: 'offline' | 'live' | 'project';
}

export interface RagClientResult<T> {
  available: boolean;
  status: number | null;
  data: T | null;
  error?: string;
}
