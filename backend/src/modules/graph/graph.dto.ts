import { IsOptional, IsString, MinLength } from 'class-validator';

export class GraphExtractDto {
  @IsString()
  @MinLength(1)
  text!: string;
}

export class GraphImportDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  sourceId?: string;
}

export class GraphQueryDto {
  @IsString()
  @MinLength(1)
  query!: string;
}
