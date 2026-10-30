import { AgenticRagExecution } from './agentic-rag.execution';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { EvidencePolicyService } from '../evidence/evidence-policy.service';
import {
  AGENTIC_FAST_PATH_CAPABILITY,
  AGENTIC_RETRIEVAL_CAPABILITY,
  AGENTIC_SIMPLE_ANSWER_CAPABILITY,
  AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY,
  type AgenticFastPathCapability,
  type AgenticRetrievalCapability,
  type AgenticSimpleAnswerCapability,
  type AgenticSupportingEvidenceCapability,
} from '../contracts/agentic-rag-capabilities';
import { BadCaseFlywheelService } from '../prompts/bad-case-flywheel.service';
import { BochaSearchService } from '../../tools/bocha-search.service';
import { DashScopeRerankService } from '../../tools/dashscope-rerank.service';
import { ToolExecutionPolicyService } from '../../tools/tool-execution-policy.service';
import { ToolExecutionService } from '../../tools/tool-execution.service';
import { DocumentPermissionService } from '../../modules/document/document-permission.service';
import { ConfigService } from '@nestjs/config';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { SecurityAuditService } from '../../modules/metrics/security-audit.service';
import { TracingService } from '../../modules/tracing/tracing.service';
import { AgenticArtifactStoreService } from './agentic-artifact-store.service';
import { AgenticAnswerGenerationService } from './agentic-answer-generation.service';
import { AgentLoopService } from '../../modules/agent-loop/agent-loop.service';
import { AgenticRagState } from './agentic-rag.state';
import { StateGraph, START, END } from '@langchain/langgraph';
export { type AgenticRagRunResult } from './agentic-rag.types';

/**
 * 深度问答的 LangGraph 状态机。
 *
 * 它只在显式 Agentic 或 Auto 的充分性／复杂度门禁要求升级时运行：
 * 查询增强 → 并发检索 → 证据充分性判断 → 按需网页补证／重排 → 生成 → 反思重试。
 * 每个节点将状态和事件写入检查点，支持中断后的受控恢复，而非盲目重新执行副作用。
 */
@Injectable()
export class AgenticRagService extends AgenticRagExecution {
  constructor(
    configService: ConfigService,
    llmProvider: LlmProvider,
    @Inject(AGENTIC_RETRIEVAL_CAPABILITY)
    retrievalCapability: AgenticRetrievalCapability,
    @Inject(AGENTIC_FAST_PATH_CAPABILITY)
    fastPathCapability: AgenticFastPathCapability,
    @Inject(AGENTIC_SIMPLE_ANSWER_CAPABILITY)
    simpleAnswerCapability: AgenticSimpleAnswerCapability,
    @Inject(AGENTIC_SUPPORTING_EVIDENCE_CAPABILITY)
    supportingEvidenceCapability: AgenticSupportingEvidenceCapability,
    bochaSearchService: BochaSearchService,
    dashScopeRerankService: DashScopeRerankService,
    toolPolicy: ToolExecutionPolicyService,
    badCaseFlywheel: BadCaseFlywheelService,
    metricsService: MetricsService,
    tracingService: TracingService,
    redisProvider: RedisProvider,
    agentLoop: AgentLoopService,
    evidencePolicy: EvidencePolicyService,
    @Optional()
    toolExecution?: ToolExecutionService,
    @Optional()
    securityAudit?: SecurityAuditService,
    @Optional()
    documentPermissions?: DocumentPermissionService,
    @Optional()
    artifactStore?: AgenticArtifactStoreService,
    @Optional()
    answerGenerationService?: AgenticAnswerGenerationService,
  ) {
    super(
      configService,
      llmProvider,
      retrievalCapability,
      fastPathCapability,
      simpleAnswerCapability,
      supportingEvidenceCapability,
      bochaSearchService,
      dashScopeRerankService,
      toolPolicy,
      badCaseFlywheel,
      metricsService,
      tracingService,
      redisProvider,
      agentLoop,
      evidencePolicy,
      toolExecution,
      securityAudit,
      documentPermissions,
      artifactStore,
      answerGenerationService,
    );
    this.initGraph();
  }

  /**
   * 初始化 LangGraph 状态图
   */
  private initGraph() {
    // 保留 queryAugment 节点 id 以恢复旧 checkpoint；节点只整理 QueryPlan 结果，不再调用扩写模型。
    const workflow = new StateGraph(AgenticRagState)
      .addNode(
        'queryAugment',
        // 保留 LangGraph 节点 id，旧 checkpoint 恢复时仍能找到原节点。
        this.observedNode('queryAugment', this.prepareQueriesNode.bind(this)),
      )
      .addNode(
        'retrieval',
        this.observedNode('retrieval', this.retrievalNode.bind(this)),
      )
      .addNode(
        'sufficiency',
        this.observedNode('sufficiency', this.sufficiencyNode.bind(this)),
      )
      .addNode(
        'webSearchFallback',
        this.observedNode(
          'webSearchFallback',
          this.webSearchFallbackNode.bind(this),
        ),
      )
      .addNode(
        'rerank',
        this.observedNode('rerank', this.rerankNode.bind(this)),
      )
      .addNode(
        'generate',
        this.observedNode('generate', this.generateNode.bind(this)),
      )
      .addNode(
        'humanApprovalNode',
        this.observedNode(
          'humanApprovalNode',
          this.humanApprovalNode.bind(this),
        ),
      )
      .addNode(
        'approvalPending',
        this.observedNode(
          'approvalPending',
          this.approvalPendingNode.bind(this),
        ),
      )
      .addNode(
        'reflection',
        this.observedNode('reflection', this.reflectionNode.bind(this)),
      );

    workflow.addEdge(START, 'queryAugment');
    workflow.addEdge('queryAugment', 'retrieval');
    workflow.addEdge('retrieval', 'sufficiency');

    workflow.addConditionalEdges(
      'sufficiency',
      (state) => {
        if (state.retrievalSufficient || state.webSearchAttempted) {
          return 'rerank';
        }
        return 'webSearchFallback';
      },
      {
        rerank: 'rerank',
        webSearchFallback: 'webSearchFallback',
      },
    );

    workflow.addEdge('webSearchFallback', 'sufficiency');
    workflow.addEdge('rerank', 'generate');
    // 先单独持久化 pending 状态，再进入原生 interrupt。这样进程中断后仍能
    // 从 Checkpoint 判断“等待审批”，恢复不会依赖瞬态 SSE 事件。
    workflow.addEdge('generate', 'approvalPending');
    workflow.addEdge('approvalPending', 'humanApprovalNode');

    // humanApprovalNode → reflection（approved/skipped）或 END（rejected）
    workflow.addConditionalEdges(
      'humanApprovalNode',
      (state) => {
        if (state.humanApproval === 'rejected') return END;
        return 'reflection';
      },
      {
        reflection: 'reflection',
        [END]: END,
      },
    );

    workflow.addConditionalEdges(
      'reflection',
      (state) => {
        const action = this.reflectionRouter(state);
        return action === 'retry' ? 'retrieval' : END;
      },
      {
        retrieval: 'retrieval',
        [END]: END,
      },
    );

    this.app = workflow.compile({
      checkpointer: this.checkpointer,
    });
  }
}
