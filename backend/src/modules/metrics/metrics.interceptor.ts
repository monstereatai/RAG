import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, start),
        error: () => this.record(req, res, start),
      }),
    );
  }

  private record(req: Request, res: Response, start: bigint): void {
    if (req.path === '/api/metrics') return;

    const durationNs = process.hrtime.bigint() - start;
    const durationSeconds = Number(durationNs) / 1_000_000_000;
    const routePath = this.getRoutePath(req);
    const route = routePath ? req.baseUrl + routePath : req.path;

    this.metricsService.observeHttpRequest(
      req.method,
      route,
      res.statusCode,
      durationSeconds,
    );
  }

  private getRoutePath(req: Request): string | null {
    const route = req.route as unknown;
    if (
      typeof route === 'object' &&
      route !== null &&
      'path' in route &&
      typeof route.path === 'string'
    ) {
      return route.path;
    }
    return null;
  }
}
