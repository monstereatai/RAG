import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * 注册入参：POST /auth/register
 * 校验规则与 LoginDto 对齐（密码至少 6 位），邮箱唯一、用户名唯一由服务层查重。
 */
export class RegisterDto {
  /** 用户名（唯一，2-64 字符） */
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  username!: string;

  /** 密码（至少 6 位） */
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;

  /** 邮箱（唯一，用于激活与找回密码） */
  @IsEmail()
  @MaxLength(255)
  email!: string;

  /** 真实姓名（可选） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  realName?: string;
}

/** 注册返回体（emailVerified 固定 false，需先完成邮箱激活） */
export interface RegisterResponse {
  userId: string;
  username: string;
  email: string;
  realName?: string;
  emailVerified: boolean;
  /** 面向用户的下一步提示 */
  message: string;
}
