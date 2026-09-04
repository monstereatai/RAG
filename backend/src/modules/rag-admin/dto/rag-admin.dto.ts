import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  // 按权限主体类型过滤：public=公共文档，department=部门文档
  @IsOptional()
  @IsIn(['public', 'department'])
  scope?: 'public' | 'department';

  // scope=department 时按权限主体 id（部门 id）二次过滤
  @IsOptional()
  @IsString()
  departmentId?: string;

  // 按生命周期状态过滤（draft/confirmed/effective/deprecated/archived）
  @IsOptional()
  @IsString()
  lifecycleStatus?: string;

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
