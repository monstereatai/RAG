import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { TracingService } from './tracing.service';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracingService: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // 获取请求信息
    const method = request.method;
    const path = request.route?.path || request.path;
    const userAgent = request.get('user-agent');
    const ip = request.ip;

    // 创建trace context
    const traceContext = this.tracingService.startSpan(
      `${method} ${path}`,
      undefined,
      {
        method,
        path,
        userAgent,
        ip,
      }
    );

    // 设置trace ID到request中
    request.traceContext = traceContext;

    // 记录开始时间
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        // 请求成功
        const duration = Date.now() - startTime;

        this.tracingService.setTag(traceContext.spanId, 'http.status', response.statusCode);
        this.tracingService.setTag(traceContext.spanId, 'http.duration', duration);

        if (response.statusCode >= 400) {
          this.tracingService.setTag(traceContext.spanId, 'error', true);
        }

        this.tracingService.endSpan(traceContext.spanId, {
          http: {
            method,
            path,
            status: response.statusCode,
            duration,
          },
        });
      }),
      catchError((error) => {
        // 请求失败
        const duration = Date.now() - startTime;

        this.tracingService.setTag(traceContext.spanId, 'http.status', error.status || 500);
        this.tracingService.setTag(traceContext.spanId, 'http.duration', duration);
        this.tracingService.setTag(traceContext.spanId, 'error', true);

        this.tracingService.error(traceContext.spanId, error, {
          method,
          path,
        });

        this.tracingService.endSpan(traceContext.spanId, {
          http: {
            method,
            path,
            status: error.status || 500,
            duration,
          },
        });

        throw error;
      })
    );
  }
}
