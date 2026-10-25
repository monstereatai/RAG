/**
 * 旧 import 路径保留给历史插件和编译产物。新代码直接使用 rag/planning。
 * 这里不再包含第二套路由提示词或业务规则。
 */
export { QueryPlannerService as QueryIntentRouter } from '../planning/query-planner.service';
export {
  queryPlanSchema as queryIntentSchema,
  resolveStandaloneRetrievalQuery,
  isObjectiveKnowledgePlan as isObjectiveKnowledgeIntent,
  shouldClarifyQueryPlan as shouldClarifyQueryIntent,
  adaptStoredQueryPlan,
} from '../planning/query-plan';
export type { QueryPlan as QueryIntent } from '../planning/query-plan';
