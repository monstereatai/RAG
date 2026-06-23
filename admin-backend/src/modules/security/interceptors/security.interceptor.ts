import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { SecurityService } from '../security.service';

@Injectable()
export class SecurityInterceptor implements NestInterceptor {
  constructor(private readonly securityService: SecurityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // 记录安全事件
    this.securityService.logSecurityEvent({
      type: 'REQUEST',
      ip: request.ip,
      userAgent: request.get('user-agent') || 'Unknown',
      action: request.method,
      details: {
        url: request.url,
        timestamp: new Date().toISOString(),
      },
    });

    // 验证Host头
    const host = request.get('host');
    if (!this.securityService.validateHostHeader(host)) {
      throw new Error('Invalid Host header');
    }

    return next.handle().pipe(
      tap(() => {
        // 记录成功响应
        this.securityService.logSecurityEvent({
          type: 'RESPONSE',
          ip: request.ip,
          userAgent: request.get('user-agent') || 'Unknown',
          action: request.method,
          details: {
            url: request.url,
            statusCode: response.statusCode,
            timestamp: new Date().toISOString(),
          },
        });
      }),
      tap(
        null,
        (error) => {
          // 记录错误响应
          this.securityService.logSecurityEvent({
            type: 'ERROR',
            ip: request.ip,
            userAgent: request.get('user-agent') || 'Unknown',
            action: request.method,
            details: {
              url: request.url,
              error: error.message,
              timestamp: new Date().toISOString(),
            },
          });
        }
      )
    );
  }
}