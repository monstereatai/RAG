import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AgentEvalDto {
  @IsString()
  @MaxLength(20_000)
  query!: string;

  @IsArray()
  @IsString({ each: true })
  contexts!: string[];

  @IsString()
  @MaxLength(50_000)
  output!: string;

  @IsOptional()
  @IsIn(['general', 'prd', 'test_case'])
  taskType?: 'general' | 'prd' | 'test_case';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredClaims?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedSteps?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actualSteps?: string[];

  @IsOptional()
  toolCalls?: Array<{ name: string; success: boolean }>;

  @IsOptional()
  @IsBoolean()
  humanHandoff?: boolean;

  @IsOptional()
  @IsBoolean()
  useJudge?: boolean;
}
