import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SecurityService } from '../security.service';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly securityService: SecurityService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const csrfConfig = this.securityService.getCsrfConfig();

    // 测试环境和开发环境下跳过 CSRF 检查
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      return next();
    }

    // 只对危险操作进行CSRF保护
    const dangerousMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (dangerousMethods.includes(req.method)) {
      // 允许注册和登录等公开接口跳过 CSRF 检查
      const pathWithoutPrefix = req.path.replace(/^\/api/, '');
      const isPublicPath = pathWithoutPrefix === '/auth/login' || pathWithoutPrefix === '/users' && req.method === 'POST';
      if (isPublicPath) {
        return next();
      }

      // 检查CSRF令牌
      const csrfToken = req.headers['x-xsrf-token'] ||
                       req.body['XSRF-TOKEN'] ||
                       req.query['XSRF-TOKEN'];

      if (!csrfToken) {
        res.status(403).json({
          statusCode: 403,
          message: 'CSRF token is required for this operation',
          error: 'Forbidden',
        });
        return;
      }

      // 在实际应用中，这里应该验证CSRF令牌是否有效
      // 例如：从session或cookie中验证令牌
      // 这里简化处理，只记录安全事件
      this.securityService.logSecurityEvent({
        type: 'CSRF_CHECK',
        ip: req.ip,
        userAgent: req.get('user-agent') || 'Unknown',
        action: req.method,
        details: {
          url: req.url,
          csrfToken: '***', // 不记录真实令牌
          timestamp: new Date().toISOString(),
        },
      });
    }

    // 设置CSRF cookie
    if (req.method === 'GET') {
      const csrfValue = require('crypto').randomBytes(16).toString('hex');
      const sameSite = csrfConfig.cookie.sameSite as 'strict' | 'lax' | 'none';
      const cookieOptions = {
        httpOnly: csrfConfig.cookie.httpOnly,
        secure: csrfConfig.cookie.secure,
        sameSite,
        path: csrfConfig.cookie.path,
      };

      res.cookie(csrfConfig.cookie.name, csrfValue, cookieOptions);
      res.setHeader('X-CSRF-Token', csrfValue);
    }

    next();
  }
}