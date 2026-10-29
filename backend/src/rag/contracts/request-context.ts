import type { RetrievalScope } from '../evidence/retrieval.types';
import type { QueryPlan, QuerySourcePolicy } from '../planning/query-plan';
import type { ContextMessageBudgetSummary } from './context-budget';
import type { RetrievalExecutionPlan } from './retrieval-execution-plan';

export type RequestMode = 'simple' | 'agentic' | 'auto';

/** Immutable semantic context shared by chat execution entry points. */
export interface RequestContext {
  requestId: string;
  userId: string;
  tenantId?: string;
  threadId: string;
  query: string;
  mode: RequestMode;
  queryPlan: QueryPlan;
  executionPlan: RetrievalExecutionPlan;
  sourcePolicy: QuerySourcePolicy;
  scope?: RetrievalScope;
  deadlineAt: number;
  contextBudget?: {
    historyTokens: number;
    system: ContextMessageBudgetSummary;
    retrievalCharacters: number;
  };
  budget: {
    maxSteps: number;
    maxToolCalls: number;
    remainingSteps: number;
    remainingToolCalls: number;
  };
}
