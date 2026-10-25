import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 开发/测试环境专用接口门禁。
 *
 * debug、traces、metrics 在本地开发与测试环境允许访问；production 默认隐藏，
 * 防止误把排障接口暴露到正式环境。若正式环境确实需要 Prometheus 抓取，
 * 应通过内网网关或独立的运维鉴权显式打开 ALLOW_DEV_ENDPOINTS=true。
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const nodeEnv =
      this.configService.get<string>('nodeEnv') ??
      process.env.NODE_ENV ??
      'development';
    const explicitlyAllowed =
      (process.env.ALLOW_DEV_ENDPOINTS ?? '').trim().toLowerCase() === 'true';
    if (nodeEnv !== 'production' || explicitlyAllowed) {
      return true;
    }
    throw new NotFoundException();
  }
}
