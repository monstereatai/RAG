import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * 发送密码重置验证码入参：POST /auth/password/reset-code
 * 邮箱不存在时返回与成功一致的响应（防账号枚举）。
 */
export class PasswordResetCodeDto {
  /** 注册邮箱 */
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

/**
 * 重置密码入参：POST /auth/password/reset
 * code 为 6 位数字验证码；newPassword 至少 6 位。
 */
export class PasswordResetDto {
  /** 注册邮箱 */
  @IsEmail()
  @MaxLength(255)
  email!: string;

  /** 6 位数字验证码 */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;

  /** 新密码（至少 6 位） */
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  newPassword!: string;
}

/** 发码返回体（存在与否返回结构一致，防止枚举注册邮箱） */
export interface PasswordResetCodeResponse {
  sent: boolean;
  message: string;
}

/** 重置密码返回体 */
export interface PasswordResetResponse {
  reset: boolean;
  message: string;
}

/** 邮箱激活返回体：GET /auth/verify-email?token=xxx */
export interface VerifyEmailResponse {
  verified: boolean;
  /** token 有效但用户此前已激活时为 true（幂等重放场景） */
  alreadyVerified: boolean;
  username: string;
  email: string;
}
