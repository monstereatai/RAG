import { IsString, IsNotEmpty, IsOptional, MaxLength, IsArray, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ description: '角色名称', example: '超级管理员' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ description: '角色标识', example: 'super_admin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional({ description: '角色描述', example: '拥有系统所有权限' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '角色名称' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: '角色标识' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ description: '角色描述' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class AssignPermissionsDto {
  @ApiProperty({ description: '权限ID数组', type: [Number], example: [1, 2, 3] })
  @IsArray()
  @IsInt({ each: true })
  permissionIds: number[];
}

export class AssignRolesDto {
  @ApiProperty({ description: '角色ID数组', type: [Number], example: [1, 2] })
  @IsArray()
  @IsInt({ each: true })
  roleIds: number[];
}
