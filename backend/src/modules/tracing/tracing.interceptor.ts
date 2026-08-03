import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { finalize, Observable } from 'rxjs';
import { TracingService } from './tracing.service';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracingService: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const trace = this.tracingService.start(req.header('traceparent'));

    res.setHeader('traceparent', this.tracingService.toTraceparent(trace));

    return next.handle().pipe(finalize(() => this.record(req, res, trace)));
  }

  private record(
    req: Request,
    res: Response,
    trace: ReturnType<TracingService['start']>,
  ): void {
    if (req.path === '/api/metrics') return;

    const routePath = this.getRoutePath(req);
    const route = routePath ? req.baseUrl + routePath : req.path;
    this.tracingService.finish(trace, req.method, route, res.statusCode);
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
