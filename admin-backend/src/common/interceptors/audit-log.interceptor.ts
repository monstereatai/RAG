import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_LOG_KEY, AuditLogMetadata } from '../decorators/audit-log.decorator';
import { AuditService } from '../../modules/security/audit.service';
import { trace } from '@opentelemetry/api';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<AuditLogMetadata>(AUDIT_LOG_KEY, context.getHandler());
    
    // 如果没有标记为需要审计的接口，直接跳过
    if (!auditMeta) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const { user, ip, body } = req;
    
    const traceId = trace.getActiveSpan()?.spanContext()?.traceId || '';

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          this.auditService.logAction({
            module: auditMeta.module,
            action: auditMeta.action,
            userId: user?.userId ? String(user.userId) : undefined,
            username: user?.username,
            requestData: JSON.stringify(body || {}),
            responseData: JSON.stringify(responseData || {}),
            ip: ip,
            traceId: traceId,
          });
        },
        error: (error) => {
          this.auditService.logAction({
            module: auditMeta.module,
            action: auditMeta.action + '_FAILED',
            userId: user?.userId ? String(user.userId) : undefined,
            username: user?.username,
            requestData: JSON.stringify(body || {}),
            responseData: JSON.stringify({ error: error.message }),
            ip: ip,
            traceId: traceId,
          });
        }
      }),
    );
  }
}
