import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map, tap } from 'rxjs';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';
import { ApiResponse } from '../interfaces/api-response.interface';

/**
 * 统一响应格式拦截器：{ code, data, message }
 * 同时记录请求耗时日志。
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  private readonly logger = new Logger(TransformInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
    }>();
    const { method, url } = request;
    const startTime = Date.now();

    // 标注 SkipTransform 的接口返回原文（如 Prometheus 指标文本），不做统一包裹
    const skipTransform =
      Reflect.getMetadata(SKIP_TRANSFORM_KEY, context.getHandler()) === true ||
      Reflect.getMetadata(SKIP_TRANSFORM_KEY, context.getClass()) === true;

    if (skipTransform) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log(`${method} ${url} ${duration}ms`);
      }),
      map((data) => ({
        code: 200,
        data,
        message: 'success',
      })),
    );
  }
}
