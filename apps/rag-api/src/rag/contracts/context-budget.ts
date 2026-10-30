export type ContextMessageSource =
  | 'context_policy'
  | 'role_preset'
  | 'session_memory'
  | 'short_term_summary'
  | 'user_memory'
  | 'history_search'
  | 'agent_skill';

/** One system-context item with explicit provenance and retention priority. */
export interface ContextMessageCandidate {
  source: ContextMessageSource;
  role: 'system';
  content: string;
  priority: number;
  required?: boolean;
}

export interface BudgetedContextMessage {
  source: ContextMessageSource;
  role: 'system';
  content: string;
}

export interface ContextMessageBudgetSummary {
  budgetTokens: number;
  estimatedTokens: number;
  overflowTokens: number;
  retainedSources: ContextMessageSource[];
  droppedSources: ContextMessageSource[];
}

export interface ContextMessageBudgetResult extends ContextMessageBudgetSummary {
  messages: BudgetedContextMessage[];
}
