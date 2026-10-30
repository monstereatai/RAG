import {
  ArrayMaxSize,
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
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(10_000, { each: true })
  contexts!: string[];

  @IsString()
  @MaxLength(50_000)
  output!: string;

  @IsOptional()
  @IsIn(['general', 'prd', 'test_case'])
  taskType?: 'general' | 'prd' | 'test_case';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(2_000, { each: true })
  requiredClaims?: string[];

  /** 标注集中的关键证据线索，用于计算最终上下文召回率。 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(2_000, { each: true })
  expectedContextClaims?: string[];

  /** 兼容旧客户端字段；没有服务端 run/trace 关联时不用于质量结论。 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedSteps?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actualSteps?: string[];

  /** 兼容旧客户端字段；客户端自报的工具结果不计入评测。 */
  @IsOptional()
  toolCalls?: Array<{ name: string; success: boolean }>;

  @IsOptional()
  @IsBoolean()
  humanHandoff?: boolean;

  /** 只有显式启用并成功调用裁判，才计算语义质量分数。 */
  @IsOptional()
  @IsBoolean()
  useJudge?: boolean;
}
