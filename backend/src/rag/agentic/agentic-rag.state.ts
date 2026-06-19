import { Annotation } from '@langchain/langgraph';
import type { RetrievedChunk } from '../karpathy/karpathy-rag.service';

/**
 * Agentic RAG 工作流状态
 *
 * 节点流转：
 *   router → (simple|agentic)
 *   agentic: query_augment → retrieval → generate → reflection → (retry|end)
 */
export const AgenticRagState = Annotation.Root({
  /** 用户原始问题 */
  query: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  /** 路由决策：simple | agentic */
  route: Annotation<'simple' | 'agentic'>({
    reducer: (_prev, next) => next,
    default: () => 'simple',
  }),

  /** 查询扩展后的多角度问句（含原始问题） */
  augmentedQueries: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** 检索到的 chunks（去重后） */
  retrievedChunks: Annotation<RetrievedChunk[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** 检索结果是否足够支撑生成 */
  retrievalSufficient: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** 检索充分性评估理由 */
  retrievalReason: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  /** LLM 生成的答案 */
  answer: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  /** Reflection 置信度（0~1） */
  confidence: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** 当前重试次数 */
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** 是否通过 reflection */
  passed: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** 人工审批状态：null=未到审批环节，'pending'=等待审批，'approved'=已通过，'rejected'=已拒绝 */
  humanApproval: Annotation<'pending' | 'approved' | 'rejected' | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** 人工审批中断原因 */
  interruptReason: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
});

export type AgenticRagStateType = typeof AgenticRagState.State;
