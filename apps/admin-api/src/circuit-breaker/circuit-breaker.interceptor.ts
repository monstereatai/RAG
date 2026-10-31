import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, timeout, map } from 'rxjs/operators';
import { CircuitBreakerService } from './circuit-breaker.service';

const WORKSPACE_PREVIEW_TIMEOUT_MS = 90_000;

type TimeoutRequest = {
  method?: string;
  path?: string;
  originalUrl?: string;
  headers?: Record<string, unknown>;
};

export function resolveRequestTimeoutMs(
  path: string,
  request: TimeoutRequest,
): number {
  const requestPath = request.path ?? request.originalUrl ?? '';
  if (request.method === 'GET' && path.includes('/documents/operations')) {
    return 110_000;
  }

  return path.includes('/workspace/preview/')
    ? WORKSPACE_PREVIEW_TIMEOUT_MS
    : path.includes('/workspace/agent')
      ? 530_000
      : path.includes('/workspace/command')
        ? 270_000
        : path.includes('/workspace/dev-server/start')
          ? 60_000
          : path.includes('/workspace/start') || path.includes('/workspace/export')
            ? 180_000
            : path.includes('/workspace')
              ? 30_000
              : path.includes('/generate-project')
                ? 180_000
                : request.method === 'POST' && requestPath.includes('/documents/upload')
                  ? 10 * 60 * 1000
                  : request.method === 'POST' && requestPath.includes('/qa-ops/attachments')
                    ? 120_000
                    : 5_000;
}

@Injectable()
export class CircuitBreakerInterceptor implements NestInterceptor {
  constructor(private readonly circuitBreaker: CircuitBreakerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path = request.route?.path || 'unknown';
    const method = request.method;
    const key = `${method}:${path}`;
    const timeoutMs = resolveRequestTimeoutMs(path, request);

    if (this.isSseRequest(request)) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError(error => {
        throw error;
      }),
      map(result => this.circuitBreaker.execute(
        key,
        () => Promise.resolve(result)
      ))
    ).pipe(
      catchError(error => {
        // 检查是否是熔断器错误
        if (error.message.includes('Circuit breaker is OPEN')) {
          console.log(`Circuit breaker triggered for ${key}`);
        }
        return throwError(() => error);
      })
    );
  }

  private isSseRequest(request: { headers?: Record<string, unknown>; path?: string; originalUrl?: string }): boolean {
    const accept = String(request.headers?.accept ?? '');
    const path = request.path ?? request.originalUrl ?? '';
    return accept.includes('text/event-stream') || path.includes('/agui/stream');
  }

}
