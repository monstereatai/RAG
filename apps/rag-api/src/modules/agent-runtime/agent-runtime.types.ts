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
  selectedSkillVersions: Record<string, string>;
  skillMatching?: 'matched' | 'skipped_simple';
  contextPolicy: {
    isolatedByThread: boolean;
    allowCrossThreadMemory: boolean;
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
