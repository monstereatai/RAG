import { Injectable } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { AgentLoopService } from '../agent-loop/agent-loop.service';
import {
  type ProductionEvidence,
  type ProductionRole,
  type ProductionToolExecution,
} from './production-workflow.state';

const ROLE_SEARCH_FOCUS: Record<ProductionRole, string> = {
  product: '历史活动规则、PRD、验收标准、地区版本和业务边界',
  design: '页面结构、设计规范、素材尺寸、多端状态和多语言适配',
  frontend: '组件规范、状态管理、接口依赖、埋点、性能和异常降级',
  backend: '接口契约、资格校验、幂等、库存、发奖、补偿和可观测性',
  qa: '测试矩阵、边界条件、异常恢复、兼容、回归和上线门禁',
  operations: '发布计划、活动配置、灰度、监控、应急预案和复盘指标',
};

export interface ProductionRoleToolPolicy {
  allowedTools: readonly string[];
  maxCalls: number;
  timeoutMs: number;
  fallback: string;
}

export const PRODUCTION_ROLE_TOOL_POLICIES: Record<
  ProductionRole,
  ProductionRoleToolPolicy
> = {
  product: {
    allowedTools: ['product_knowledge_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的产品规则标记为待确认。',
  },
  design: {
    allowedTools: ['design_guideline_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的设计规格标记为待确认。',
  },
  frontend: {
    allowedTools: ['frontend_engineering_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的工程约束标记为待确认。',
  },
  backend: {
    allowedTools: ['backend_contract_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的接口和数据规则标记为待确认。',
  },
  qa: {
    allowedTools: ['qa_regression_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的验收口径标记为待确认。',
  },
  operations: {
    allowedTools: ['operations_playbook_search'],
    maxCalls: 1,
    timeoutMs: 8_000,
    fallback: '无证据的发布配置和运营规则标记为待确认。',
  },
};

export interface ProductionRoleToolContext {
  projectId: string;
  brief: string;
  userId: string;
  threadId?: string;
  runId?: string;
  pluginKeys?: string[];
  pluginTools?: string[];
}

export interface ProductionRoleToolResult {
  evidence: ProductionEvidence[];
  executions: ProductionToolExecution[];
}

@Injectable()
export class ProductionWorkflowTools {
  private readonly evidenceLimit = 6;

  constructor(
    private readonly rag: KarpathyRagService,
    private readonly toolPolicy: ToolExecutionPolicyService,
    private readonly agentLoop: AgentLoopService,
  ) {}

  async gather(
    role: ProductionRole,
    context: ProductionRoleToolContext,
  ): Promise<ProductionRoleToolResult> {
    const startedAt = Date.now();
    const policy = PRODUCTION_ROLE_TOOL_POLICIES[role];
    const tool = policy.allowedTools[0];
    const authorization = this.toolPolicy.decide(tool, {
      mode: 'production',
      role,
      pluginKeys: context.pluginKeys,
      allowedToolNames: context.pluginTools,
    });
    if (!authorization.allowed) {
      return {
        evidence: [],
        executions: [
          {
            tool,
            status: 'blocked',
            durationMs: Date.now() - startedAt,
            evidenceCount: 0,
            fallback: policy.fallback,
            error: authorization.reason,
          },
        ],
      };
    }
    const query = `${context.brief}\n请检索与${ROLE_SEARCH_FOCUS[role]}直接相关、当前有效且可引用的证据。`;
    try {
      type GatherLoopState = {
        retrieval?: Awaited<ReturnType<KarpathyRagService['retrieveDetailed']>>;
      };
      const loop = await this.agentLoop.run<GatherLoopState, GatherLoopState>({
        threadId: context.threadId ?? `production:${context.projectId}`,
        runId: context.runId,
        actor: role,
        initialState: {},
        maxSteps: 2,
        maxToolCalls: policy.maxCalls,
        timeoutMs: policy.timeoutMs + 1_000,
        decide: (state) =>
          state.retrieval
            ? {
                type: 'complete',
                output: state,
                reason: `${role} 岗位证据检索完成`,
              }
            : {
                type: 'tool',
                name: tool,
                mode: 'production',
                role,
                ownerUserId: context.userId,
                pluginKeys: context.pluginKeys,
                allowedToolNames: context.pluginTools,
                input: { query, focus: ROLE_SEARCH_FOCUS[role] },
                execute: () =>
                  this.withTimeout(
                    this.rag.retrieveDetailed(
                      query,
                      { scope: { role } },
                      context.userId,
                    ),
                    policy.timeoutMs,
                  ),
                reduce: (
                  current: GatherLoopState,
                  retrieval: Awaited<
                    ReturnType<KarpathyRagService['retrieveDetailed']>
                  >,
                ) => ({
                  ...current,
                  retrieval,
                }),
              },
      });
      const result = loop.output?.retrieval;
      if (!result) {
        return {
          evidence: [],
          executions: [
            {
              tool,
              status: loop.status === 'blocked' ? 'blocked' : 'failed',
              durationMs: Date.now() - startedAt,
              evidenceCount: 0,
              fallback: policy.fallback,
              error: loop.terminationReason,
            },
          ],
        };
      }
      const evidence = result.chunks
        .slice(0, this.evidenceLimit)
        .map((chunk) => ({
          id: chunk.id,
          docId: chunk.docId,
          chunkIndex: chunk.chunkIndex,
          excerpt: chunk.content.slice(0, 1_500),
          totalScore: chunk.totalScore,
          headingPath: chunk.headingPath,
          sourceStart: chunk.sourceStart,
          sourceEnd: chunk.sourceEnd,
          docVersion: chunk.docVersion,
        }));
      return {
        evidence,
        executions: [
          {
            tool,
            status: evidence.length > 0 ? 'success' : 'degraded',
            durationMs: Date.now() - startedAt,
            evidenceCount: evidence.length,
            fallback: evidence.length > 0 ? undefined : policy.fallback,
          },
        ],
      };
    } catch (error) {
      return {
        evidence: [],
        executions: [
          {
            tool,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            evidenceCount: 0,
            fallback: policy.fallback,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`role tool timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
