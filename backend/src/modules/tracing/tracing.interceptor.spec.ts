import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TracingInterceptor } from './tracing.interceptor';

describe('TracingInterceptor', () => {
  it('records a multi-event SSE response only once', async () => {
    const tracing = {
      start: jest.fn().mockReturnValue({}),
      toTraceparent: jest.fn().mockReturnValue('traceparent'),
      finish: jest.fn(),
    };
    const request = {
      header: jest.fn(),
      path: '/api/agui/admin/stream',
      baseUrl: '/api/v1/agui/admin',
      method: 'GET',
      route: { path: '/stream' },
    };
    const response = { setHeader: jest.fn(), statusCode: 200 };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of(1, 2, 3) } as CallHandler;

    await lastValueFrom(
      new TracingInterceptor(tracing as never).intercept(context, next),
    );

    expect(tracing.finish).toHaveBeenCalledTimes(1);
  });
});
