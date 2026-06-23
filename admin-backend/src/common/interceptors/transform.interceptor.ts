import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';

/**
 * 统一响应格式拦截器。
 *
 * 所有正常返回值包装为：
 * { code: number, message: 'success', data: T }
 *
 * 错误响应由 HttpExceptionFilter 统一处理，不经过此拦截器。
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request.path === '/metrics') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        code: response.statusCode || 200,
        message: 'success',
        data,
      })),
    );
  }
}