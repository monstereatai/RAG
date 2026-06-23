import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'john_doe' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @MinLength(3, { message: '用户名至少3个字符' })
  @MaxLength(50, { message: '用户名不能超过50个字符' })
  username: string;

  @ApiProperty({ description: '密码（至少8位，含大小写字母、数字、特殊字符）', example: 'Password@123' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(8, { message: '密码至少8位' })
  @MaxLength(100, { message: '密码不能超过100个字符' })
  password: string;

  @ApiProperty({ description: '邮箱', example: 'john@example.com' })
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @ApiPropertyOptional({ description: '角色', enum: ['user', 'admin'], default: 'user' })
  @IsOptional()
  @IsIn(['user', 'admin'], { message: '角色必须是 user 或 admin' })
  role?: string;
}
