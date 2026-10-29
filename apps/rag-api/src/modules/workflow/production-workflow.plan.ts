import {
  PRODUCTION_ROLES,
  type ProductionRole,
} from './production-workflow.state';

const ROLE_DEPENDENCIES: Record<ProductionRole, ProductionRole[]> = {
  product: [],
  design: ['product'],
  backend: ['product'],
  frontend: ['design', 'backend'],
  qa: ['product', 'design', 'frontend', 'backend'],
  operations: ['product', 'design', 'frontend', 'backend', 'qa'],
};

export function dependenciesForProductionRole(
  role: ProductionRole,
  selectedRoles: ProductionRole[],
): ProductionRole[] {
  const selected = new Set(selectedRoles);
  return ROLE_DEPENDENCIES[role].filter((dependency) =>
    selected.has(dependency),
  );
}

export function normalizeProductionRoles(
  roles?: ProductionRole[],
): ProductionRole[] {
  if (!roles?.length) return [...PRODUCTION_ROLES];
  const requested = new Set(roles);
  return PRODUCTION_ROLES.filter((role) => requested.has(role));
}

export function buildProductionExecutionBatches(
  roles: ProductionRole[],
): ProductionRole[][] {
  const remaining = new Set(roles);
  const completed = new Set<ProductionRole>();
  const batches: ProductionRole[][] = [];

  while (remaining.size > 0) {
    const batch = PRODUCTION_ROLES.filter(
      (role) =>
        remaining.has(role) &&
        dependenciesForProductionRole(role, roles).every((dependency) =>
          completed.has(dependency),
        ),
    );
    if (batch.length === 0) {
      throw new Error('production workflow dependency cycle detected');
    }
    batches.push(batch);
    for (const role of batch) {
      remaining.delete(role);
      completed.add(role);
    }
  }
  return batches;
}
