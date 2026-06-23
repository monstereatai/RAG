import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../../modules/metrics/metrics.service';

@Injectable()
export class InvokeRecordInterceptor implements NestInterceptor {
  private readonly logger = new Logger(InvokeRecordInterceptor.name);

  constructor(
    @Inject(MetricsService)
    private readonly metricsService: MetricsService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const userAgent = request.headers['user-agent'];
    const { ip, method, path } = request;

    this.logger.log(
      `${method} ${path} ${ip} ${userAgent}: ${
        context.getClass().name
      } ${
        context.getHandler().name
      } invoked...`,
    );

    const user = (request as any).user;
    if (user) {
      this.logger.log(`User: ${user.sub || user.userId}, ${user.username}`);
    }

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: (res) => {
          const duration = Date.now() - now;
          this.logger.log(
            `${method} ${path} ${ip} ${userAgent}: ${response.statusCode}: ${duration}ms`,
          );
          this.logger.debug(`Response: ${JSON.stringify(res)}`);

          const route = request.route ? request.route.path : 'unmatched';
          this.metricsService.recordRequest(method, route, response.statusCode, duration);
        },
        error: (err) => {
          const duration = Date.now() - now;
          const status = err.status || err.statusCode || 500;
          this.logger.log(
            `${method} ${path} ${ip} ${userAgent}: ${status}: ${duration}ms - Error: ${err.message}`,
          );

          const route = request.route ? request.route.path : 'unmatched';
          this.metricsService.recordRequest(method, route, status, duration);
        },
      }),
    );
  }
}
