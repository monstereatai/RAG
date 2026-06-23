import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePermissionDto {
  @ApiProperty({ description: '权限名称', example: '创建用户' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ description: '权限标识 (代码)', example: 'admin:user:create' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @ApiPropertyOptional({ description: '权限描述', example: '允许管理员创建新用户' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class UpdatePermissionDto {
  @ApiPropertyOptional({ description: '权限名称' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: '权限标识' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  code?: string;

  @ApiPropertyOptional({ description: '权限描述' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}
