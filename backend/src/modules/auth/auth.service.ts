import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { LoginDto, LoginResponse } from './dto/login.dto';

/**
 * 认证服务（M3 最简版）
 *
 * 当前使用硬编码测试用户，M2/M4 接入数据库后替换为真实用户校验。
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

    const expiresIn =
      this.configService.get<string>('auth.jwtExpiresIn') ?? '7d';
    const token = await this.jwtService.signAsync(user.payload);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('token invalid or expired');
    }
  }
}
