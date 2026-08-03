import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';

describe('MetricsInterceptor', () => {
  it('records a multi-event SSE response only once', async () => {
    const metrics = { observeHttpRequest: jest.fn() };
    const request = {
      path: '/api/agui/admin/stream',
      baseUrl: '/api/v1/agui/admin',
      method: 'GET',
      route: { path: '/stream' },
    };
    const response = { statusCode: 200 };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of(1, 2, 3) } as CallHandler;

    await lastValueFrom(
      new MetricsInterceptor(metrics as never).intercept(context, next),
    );

    expect(metrics.observeHttpRequest).toHaveBeenCalledTimes(1);
  });
});
