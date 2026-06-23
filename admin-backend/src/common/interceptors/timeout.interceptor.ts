import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(30000), // 30秒超时
      catchError((err) => {
        if (err.name === 'TimeoutError') {
          return throwError(() => ({
            statusCode: 408,
            message: 'Request timeout',
            error: 'Timeout',
          }));
        }
        return throwError(err);
      })
    );
  }
}