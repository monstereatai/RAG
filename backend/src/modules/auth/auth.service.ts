import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { LoginDto, LoginResponse } from './dto/login.dto';

/** access token 默认有效期（JWT_ACCESS_EXPIRES 未配置时） */
const DEFAULT_ACCESS_EXPIRES_IN = '2h';

/** refresh token 默认有效期（JWT_REFRESH_EXPIRES 未配置时） */
const DEFAULT_REFRESH_EXPIRES_IN = '7d';

/**
 * 认证服务（双 token 机制）
 *
 * 签发 access / refresh 两种 token：
 *   - access：短有效期（默认 2h），用于访问业务接口（JwtAuthGuard 放行）
 *   - refresh：长有效期（默认 7d），仅用于 POST /auth/refresh 换发新双 token
 *
 * 当前使用硬编码测试用户，M2/M4 接入数据库后替换为真实用户校验（含禁用状态）。
 * 测试账号：
 *   - admin / admin123（role: admin）
 *   - user / user1234（role: user）
 */
@Injectable()
export class AuthService {
  private readonly testUsers: Record<
    string,
    { password: string; payload: JwtPayload }
  > = {
    admin: {
      password: 'admin123',
      payload: { userId: '1', username: 'admin', role: 'admin' },
    },
    user: {
      password: 'user1234',
      payload: { userId: '2', username: 'user', role: 'user' },
    },
  };

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = this.testUsers[dto.username];
    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('invalid username or password');
    }

    return this.issueTokenPair(user.payload);
  }

  /**
   * 使用 refresh token 换发新的双 token（轮换）
   *
   * 校验链：验签（refresh 密钥）→ payload.type 必须为 refresh
   * → 用户仍存在且未禁用，任一步失败均返回 401。
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('refresh token invalid or expired');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('refresh token type invalid');
    }

    const user = this.testUsers[payload.username];
    // 硬编码用户表即"存在且未禁用"名单；接入数据库后替换为 users 表查询 + 禁用状态校验
    if (!user || user.payload.userId !== payload.userId) {
      throw new UnauthorizedException('user not found or disabled');
    }

    return this.issueTokenPair(user.payload);
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('token invalid or expired');
    }
  }

  /**
   * 签发 access + refresh 双 token
   *
   * access 用 JwtModule 主密钥（JWT_SECRET）签发；refresh 优先用
   * JWT_REFRESH_SECRET 独立密钥签发，未配置时回落主密钥，
   * 由 JwtAuthGuard 的 type 校验兜底拒绝。
   */
  private async issueTokenPair(base: JwtPayload): Promise<LoginResponse> {
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES') ??
      DEFAULT_ACCESS_EXPIRES_IN;
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES') ??
      DEFAULT_REFRESH_EXPIRES_IN;

    const accessPayload: JwtPayload = { ...base, type: 'access' };
    const refreshPayload: JwtPayload = { ...base, type: 'refresh' };

    // expiresIn 是环境变量里的自由字符串（如 '2h'/'7d'），与 jsonwebtoken 的
    // StringValue 模板字面量类型不兼容，参照 auth.module.ts 的做法显式断言
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: accessExpiresIn,
      } as unknown as JwtSignOptions),
      this.jwtService.signAsync(
        refreshPayload,
        {
          secret: this.refreshSecret,
          expiresIn: refreshExpiresIn,
        } as unknown as JwtSignOptions,
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresIn,
      refreshTokenExpiresIn: refreshExpiresIn,
    };
  }

  /** refresh token 签发/验签密钥：JWT_REFRESH_SECRET 未配置时回落 JWT_SECRET */
  private get refreshSecret(): string {
    return (
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      ''
    );
  }
}
