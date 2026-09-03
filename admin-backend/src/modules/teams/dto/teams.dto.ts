import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TEAM_MEMBER_ROLES } from '../../../database/entities/team-member.entity';

export class CreateTeamDto {
  @ApiProperty({ description: '团队名称', example: '研发部' })
  @IsString()
  @IsNotEmpty({ message: '团队名称不能为空' })
  @MaxLength(100, { message: '团队名称最长 100 个字符' })
  name: string;

  @ApiPropertyOptional({ description: '团队描述', example: '负责产品研发' })
  @IsString()
  @IsOptional()
  @MaxLength(255, { message: '团队描述最长 255 个字符' })
  description?: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ description: '团队名称' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: '团队名称最长 100 个字符' })
  name?: string;

  @ApiPropertyOptional({ description: '团队描述' })
  @IsString()
  @IsOptional()
  @MaxLength(255, { message: '团队描述最长 255 个字符' })
  description?: string;
}

export class AddTeamMemberDto {
  @ApiProperty({ description: '用户 ID', example: 2 })
  @IsInt({ message: 'userId 必须是整数' })
  userId: number;

  @ApiPropertyOptional({ description: '团队内角色', enum: ['owner', 'member'], default: 'member' })
  @IsIn(TEAM_MEMBER_ROLES as unknown as string[], { message: '团队内角色只能是 owner 或 member' })
  @IsOptional()
  role?: string;
}
