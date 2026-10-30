export const PRODUCTION_ARTIFACT_TARGETS = [
  'activity-schema',
  'vue-page',
  'react-page',
  'dashboard-schema',
  'vue-dashboard',
  'react-dashboard',
] as const;

export type ProductionArtifactTarget =
  (typeof PRODUCTION_ARTIFACT_TARGETS)[number];
export type ProductionSchemaTarget = 'activity-schema' | 'dashboard-schema';
export type ProductionCodeTarget = Exclude<
  ProductionArtifactTarget,
  ProductionSchemaTarget
>;

export type SchemaObject = Record<string, unknown>;
export type CodeFiles = Record<string, string>;

export const LABELS: Record<ProductionArtifactTarget, string> = {
  'activity-schema': '活动页 JSON Schema',
  'vue-page': 'Vue 活动页项目',
  'react-page': 'React 活动页项目',
  'dashboard-schema': '数字大屏 Schema',
  'vue-dashboard': 'Vue 数字大屏项目',
  'react-dashboard': 'React 数字大屏项目',
};
