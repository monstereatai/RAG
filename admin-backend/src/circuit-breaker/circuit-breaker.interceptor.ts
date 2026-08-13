import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, timeout, map } from 'rxjs/operators';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class CircuitBreakerInterceptor implements NestInterceptor {
  constructor(private readonly circuitBreaker: CircuitBreakerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path = request.route?.path || 'unknown';
    const method = request.method;
    const key = `${method}:${path}`;
    const timeoutMs = path.includes('/generate-project') ? 180_000 : 5_000;

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
