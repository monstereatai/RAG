import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { JobType } from '../job.types';

export class CreateJobDto {
  @IsIn(['cron', 'every', 'at'])
  type: JobType;

  @IsString()
  @MinLength(1)
  instruction: string;

  @ValidateIf((dto: CreateJobDto) => dto.type === 'cron')
  @IsString()
  @MinLength(1)
  cron?: string;

  @ValidateIf((dto: CreateJobDto) => dto.type === 'every')
  @IsInt()
  @Min(1000)
  everyMs?: number;

  @ValidateIf((dto: CreateJobDto) => dto.type === 'at')
  @IsISO8601()
  at?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
