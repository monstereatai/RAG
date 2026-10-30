import { z } from 'zod';

export interface StoredTurn {
  messageId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts?: number;
}

export const DEFAULT_MESSAGE_SAFETY_CAP = 200;

export const TTL_SECONDS = 86400;

export const MAX_HISTORY_CONTEXT_TOKENS = 8_000;

export const SYSTEM_CONTEXT_RESERVE_TOKENS = 2_048;

export const MAX_RETRIEVAL_CONTEXT_CHARACTERS = 10_000;

export const COMPACTION_TRIGGER_RATIO = 0.9;

export const COMPACTION_TARGET_TOKEN_RATIO = 0.7;

export const COMPACTION_RETAINED_MESSAGE_RATIO = 0.3;

export const COMPACTION_LOCK_TTL_SECONDS = 300;

export const HISTORY_CACHE_LOCK_TTL_SECONDS = 30;

export const SUMMARY_RECOVERY_PAGE_SIZE = 100;

export const SUMMARY_RECOVERY_CHUNK_TOKEN_BUDGET = 5_000;

export const SUMMARY_RECOVERY_MESSAGE_PART_CHARACTERS = 1_200;

export const SUMMARY_RECOVERY_PREVIOUS_TOKEN_BUDGET = 1_500;

export const SUMMARY_RECOVERY_RECENT_MESSAGE_COUNT = DEFAULT_MESSAGE_SAFETY_CAP;

export const COMPACTION_STRATEGY_CONFIDENCE_THRESHOLD = 0.6;

export const SUMMARY_MAX_LIST_ITEMS = 12;

export const SUMMARY_MAX_ITEM_CHARACTERS = 160;

export const SUMMARY_MAX_GOAL_CHARACTERS = 240;

export const SUMMARY_MAX_DIGEST_CHARACTERS = 500;

export type CompactionStrategy = 'middle-removal' | 'oldest-removal' | 'hybrid';

export type RemovalStrategy = Exclude<CompactionStrategy, 'hybrid'>;

export const structuredMemorySummarySchema = z.object({
  schemaVersion: z.literal(1),
  compactedThroughMessageId: z.string().optional(),
  compactedMessageIds: z.array(z.string()).optional(),
  currentGoal: z.string().default(''),
  constraints: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  changes: z.array(
    z.object({
      role: z.string(),
      module: z.string(),
      before: z.string(),
      after: z.string(),
      version: z.string(),
      effectiveFrom: z.string(),
      evidence: z.string(),
    }),
  ),
  decisions: z.array(z.string()),
  openIssues: z.array(z.string()),
  sourceDigest: z.string(),
});

export type StructuredMemorySummary = z.infer<
  typeof structuredMemorySummarySchema
>;

export interface ContextCompactionAudit {
  id: string;
  status: 'started' | 'completed' | 'failed';
  reason: 'turn_window' | 'token_budget' | 'manual';
  sourceTurnCount: number;
  retainedTurnCount: number;
  sourceTokenEstimate: number;
  baseStrategy?: CompactionStrategy;
  selectedStrategy?: RemovalStrategy;
  strategyConfidence?: number;
  adaptiveComparison?: Record<string, number>;
  summaryMode?: 'llm';
  promptVersion?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
