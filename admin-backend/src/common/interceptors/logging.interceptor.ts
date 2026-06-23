import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const { method, url } = request;
    const userAgent = request.get('user-agent');

    // 请求开始时间
    const startTime = Date.now();

    // 记录请求
    console.log(`[${new Date().toISOString()}] ${method} ${url} - User-Agent: ${userAgent}`);

    return next.handle().pipe(
      tap(() => {
        // 响应完成
        const duration = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] ${method} ${url} - ${response.statusCode} - ${duration}ms`);
      })
    );
  }
}
