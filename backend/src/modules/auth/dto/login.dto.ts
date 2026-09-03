import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(2)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class RefreshTokenDto {
  /** 登录/上次刷新时签发的 refresh token（完整 JWT） */
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}

export interface LoginResponse {
  /** 业务访问 token（type=access），用于携带访问业务接口 */
  accessToken: string;
  /** 刷新 token（type=refresh），仅用于 POST /auth/refresh 换发新双 token */
  refreshToken: string;
  tokenType: 'Bearer';
  /** access token 有效期（如 2h） */
  expiresIn: string;
  /** refresh token 有效期（如 7d），客户端可据此安排静默刷新 */
  refreshTokenExpiresIn: string;
}
