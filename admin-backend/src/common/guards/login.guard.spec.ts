import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { LoginGuard } from './login.guard';

describe('LoginGuard', () => {
  let guard: LoginGuard;
  const jwtService = {
    verify: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(() => undefined),
          },
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
      ],
    }).compile();

    guard = module.get(LoginGuard);
    jwtService.verify.mockReset();
  });

  it('accepts query token for EventSource requests', async () => {
    jwtService.verify.mockReturnValue({
      type: 'access',
      sub: 'user-1',
      username: 'admin',
      role: 'admin',
      permissions: ['admin:qa-ops:read'],
    });
    const request: Record<string, unknown> = {
      headers: {},
      query: { token: 'query.jwt.token' },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getClass: () => LoginGuard,
      getHandler: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('query.jwt.token');
    expect(request.user).toEqual({
      userId: 'user-1',
      username: 'admin',
      role: 'admin',
      permissions: ['admin:qa-ops:read'],
    });
  });

  it('rejects refresh tokens on protected routes', async () => {
    jwtService.verify.mockReturnValue({ type: 'refresh', sub: 1, username: 'admin' });
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer refresh.jwt.token' }, query: {} }),
      }),
      getClass: () => LoginGuard,
      getHandler: () => undefined,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toThrow('token 失效，请重新登录');
  });
});
