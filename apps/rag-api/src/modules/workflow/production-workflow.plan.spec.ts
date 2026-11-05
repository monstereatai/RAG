import {
  buildProductionExecutionBatches,
  dependenciesForProductionRole,
  normalizeProductionRoles,
} from './production-workflow.plan';

describe('production workflow execution plan', () => {
  it('builds hierarchical batches from production dependencies', () => {
    const roles = normalizeProductionRoles();

    expect(buildProductionExecutionBatches(roles, 'hierarchical')).toEqual([
      ['product'],
      ['design', 'backend'],
      ['frontend'],
      ['qa'],
      ['operations'],
    ]);
  });

  it('runs sequential mode in dependency order one role at a time', () => {
    expect(
      buildProductionExecutionBatches(normalizeProductionRoles(), 'sequential'),
    ).toEqual([
      ['product'],
      ['design'],
      ['backend'],
      ['frontend'],
      ['qa'],
      ['operations'],
    ]);
  });

  it('rejects conditional mode until executable role conditions exist', () => {
    expect(() =>
      buildProductionExecutionBatches(['product'], 'conditional'),
    ).toThrow('conditional workflow requires role conditions');
  });

  it('removes dependencies for roles that are not selected', () => {
    const roles = normalizeProductionRoles(['qa', 'design', 'backend']);

    expect(roles).toEqual(['design', 'backend', 'qa']);
    expect(buildProductionExecutionBatches(roles, 'hierarchical')).toEqual([
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
