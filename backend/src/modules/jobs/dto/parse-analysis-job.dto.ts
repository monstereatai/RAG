import { IsIn, IsString, MinLength } from 'class-validator';
import type { ScheduledJobSourceType } from '../job.types';

export class ParseAnalysisJobDto {
  @IsString()
  @MinLength(1)
  sourceText!: string;

  @IsIn(['natural_language', 'markdown'])
  sourceType!: ScheduledJobSourceType;
}
