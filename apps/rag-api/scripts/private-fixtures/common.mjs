export function syntheticProvenance() {
  return {
    kind: 'synthetic_fixture',
    generator: 'scripts/prepare-private-fixtures.mjs',
    containsRealBusinessData: false,
  };
}
