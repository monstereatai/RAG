import { BadRequestException } from '@nestjs/common';
import { resolveProductionRoleAgentPlan } from './production-role-agent-policy';

describe('resolveProductionRoleAgentPlan', () => {
  it.each([
    ['frontend', 'code', 'coding'],
    ['backend', 'code', 'coding'],
    ['qa', 'verify', 'testing'],
  ] as const)('allows %s/%s as %s', (role, task, execution) => {
    expect(resolveProductionRoleAgentPlan({ role, task })).toEqual({
      role,
      task,
      execution,
    });
  });

  it('preserves the legacy request as frontend code execution', () => {
    expect(resolveProductionRoleAgentPlan({})).toEqual({
      role: 'frontend',
      task: 'code',
      execution: 'coding',
    });
  });

  it.each([
    { role: 'frontend', task: 'verify' },
    { role: 'backend', task: 'verify' },
    { role: 'qa', task: 'code' },
    { role: 'product', task: 'code' },
    { role: 'frontend' },
    { task: 'verify' },
  ])('rejects invalid combination %j', (input) => {
    expect(() => resolveProductionRoleAgentPlan(input)).toThrow(
      BadRequestException,
    );
  });
});
