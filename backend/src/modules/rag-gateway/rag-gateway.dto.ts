import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class RagSearchDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 5;
}

export class RagContextDto {
  @IsString()
  @MinLength(1)
  task!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 5;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRoadmap?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  matchSkill?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  skillLimit?: number = 3;
}
