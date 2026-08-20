export type AgentRuntimeMode = 'simple' | 'auto' | 'agentic' | 'production';

export interface AgentRuntimeStage {
  id: string;
  role: string;
  description: string;
  dependsOn: string[];
  execution: 'inline' | 'parallel' | 'checkpointed';
}

export interface AgentRuntimePlan {
  planId: string;
  mode: AgentRuntimeMode;
  objective: string;
  stages: AgentRuntimeStage[];
  selectedSkills: string[];
  contextPolicy: {
    maxHistoryTurns: number;
    maxContextCharacters: number;
    compressionThreshold: number;
    isolatedByThread: boolean;
  };
  limits: {
    maxSteps: number;
    maxToolCalls: number;
    maxDelegations: number;
  };
}

export interface FailureOnset {
  found: boolean;
  sequence?: number;
  eventType?: string;
  actor?: string;
  target?: string;
  reason?: string;
  recommendation?: string;
}
