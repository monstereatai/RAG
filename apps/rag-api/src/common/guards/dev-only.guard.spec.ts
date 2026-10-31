import { NotFoundException } from '@nestjs/common';
import { DevOnlyGuard } from './dev-only.guard';

describe('DevOnlyGuard', () => {
  const guardFor = (nodeEnv: string) =>
    new DevOnlyGuard({
      get: jest.fn((key: string) => (key === 'nodeEnv' ? nodeEnv : undefined)),
    } as never);

  afterEach(() => {
    delete process.env.ALLOW_DEV_ENDPOINTS;
  });

  it('allows developer endpoints outside production', () => {
    expect(guardFor('development').canActivate()).toBe(true);
    expect(guardFor('test').canActivate()).toBe(true);
  });

  it('hides developer endpoints in production by default', () => {
    expect(() => guardFor('production').canActivate()).toThrow(
      NotFoundException,
    );
  });

  it('allows an explicit production override for internal gateways', () => {
    process.env.ALLOW_DEV_ENDPOINTS = 'true';
    expect(guardFor('production').canActivate()).toBe(true);
  });
});
