import {
  buildProductionExecutionBatches,
  dependenciesForProductionRole,
  normalizeProductionRoles,
} from './production-workflow.plan';

describe('production workflow execution plan', () => {
  it('builds parallel batches from production dependencies', () => {
    const roles = normalizeProductionRoles();

    expect(buildProductionExecutionBatches(roles)).toEqual([
      ['product'],
      ['design', 'backend'],
      ['frontend'],
      ['qa'],
      ['operations'],
    ]);
  });

  it('removes dependencies for roles that are not selected', () => {
    const roles = normalizeProductionRoles(['qa', 'design', 'backend']);

    expect(roles).toEqual(['design', 'backend', 'qa']);
    expect(buildProductionExecutionBatches(roles)).toEqual([
      ['design', 'backend'],
      ['qa'],
    ]);
  });

  it('allows every role to run independently', () => {
    for (const role of normalizeProductionRoles()) {
      expect(buildProductionExecutionBatches([role])).toEqual([[role]]);
    }
  });

  it('returns only dependencies that participate in the workflow', () => {
    expect(
      dependenciesForProductionRole('qa', ['product', 'backend', 'qa']),
    ).toEqual(['product', 'backend']);
  });
});
