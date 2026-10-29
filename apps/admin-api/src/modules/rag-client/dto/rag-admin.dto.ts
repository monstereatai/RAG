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

  /** 按权限主体类型过滤：公共 / 部门文档 */
  @IsOptional()
  @IsIn(['public', 'department'])
  scope?: string;

  /** scope=department 时按部门 ID 二次过滤 */
  @IsOptional()
  @IsString()
  departmentId?: string;

  /** 按生命周期状态过滤（如 archived 归档） */
  @IsOptional()
  @IsString()
  lifecycleStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** 前端 ProTable 传入的 current，等价于 page */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  current?: number;

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
