import type { BadCaseMatch } from '../prompts/bad-case.types';
import type {
  EvidenceBundle,
  EvidenceSourcePolicy,
} from '../evidence/evidence-bundle';
import type {
  DetailedRetrievalResult,
  RetrievalDiagnostics,
  RetrievalProfile,
  RetrievalScope,
  RetrievedChunk,
} from '../evidence/retrieval.types';
import type { ObsidianSearchHit } from '../../modules/obsidian/obsidian-knowledge.types';
import type { QueryPlan } from '../planning/query-plan';
import type { RequestContext } from './request-context';
import type { RetrievalExecutionPlan } from './retrieval-execution-plan';

export interface RagAnswerResult {
  answer: string;
  references: Array<{
    id: string;
    content: string;
    docId: string;
    chunkIndex: number;
    totalScore: number;
    /** 融合排序分的别名（与 totalScore 同值），方便下游统一按 score 消费 */
    score: number;
    bm25Score: number;
    cosineScore: number;
    /** DashScope 重排分（仅当 rerank 实际生效时携带） */
    rerankScore?: number;
    sourceAuthorityWeight?: number;
    parentChunkId?: string | null;
    headingPath?: string[];
    sectionId?: string | null;
    clauseId?: string | null;
    tableRef?: string | null;
    sourceStart?: number | null;
    sourceEnd?: number | null;
    docVersion?: string | null;
    effectiveAt?: string | null;
    expiredAt?: string | null;
    sourceAuthority?: string;
    projectId?: string | null;
    activityId?: string | null;
    region?: string | null;
    locale?: string | null;
    channel?: string | null;
    roleScope?: string[];
    documentType?: string;
    lifecycleStatus?: string;
    supersedesDocId?: string | null;
    ruleKey?: string | null;
    changeType?: string;
    supersedesChunkId?: string | null;
    retrievalSource?: RetrievedChunk['retrievalSource'];
    contextRole?: RetrievedChunk['contextRole'];
    citationLabel?: string;
  }>;
  retrievalSufficient?: boolean;
  retrievalReason?: string;
  obsidianPaths?: string[];
  obsidianHits?: ObsidianSearchHit[];
  retrievalDiagnostics?: RetrievalDiagnostics;
}

export interface PrefetchedFastPath {
  retrieval: DetailedRetrievalResult;
  obsidianHits: ObsidianSearchHit[];
  badCaseMatches?: BadCaseMatch[];
  /** 同一原始问题的权威证据结论，禁止下游按改写问题重复否决。 */
  evidenceBundle?: EvidenceBundle;
}

/** Historical retrieval options retained by the RAG facade. */
export interface RetrieveOptions {
  /** 请求级取消信号，贯穿检索与模型流式生成。 */
  signal?: AbortSignal;
  /** 认证上下文中的租户；优先于旧的单租户兼容路径参与 ACL 过滤。 */
  tenantId?: string;
  /** Set only by the ServiceTokenGuard-protected Admin AG-UI bridge. */
  trustedAdminPrincipal?: boolean;
  /** 当前用户在 IAM 中的角色名称，用于 role ACL。 */
  roles?: string[];
  /** 当前用户的部门标识，用于 department ACL。 */
  departmentIds?: string[];
  /** 合并多路检索时统一按原始用户问题重排。 */
  rankingQuery?: string;
  /** 多路检索先各自取候选，合并后只重排一次。 */
  skipRerank?: boolean;
  /** Internal only: preserve candidates for global query fusion before context cropping. */
  candidateOnly?: boolean;
  /** 无权威片段时，允许使用本轮同实体的最近用户陈述回答状态确认。 */
  allowConversationStateAnswer?: boolean;
  /** 当前问题只允许使用本地知识库，不调用联网兜底。 */
  knowledgeOnly?: boolean;
  /** 由语义路由决定的唯一联网授权；未传入时保持旧调用兼容。 */
  sourcePolicy?: EvidenceSourcePolicy;
  /** 运行中心关联 ID，仅用于把 Agent Loop 事件归入当前 Run。 */
  runtimeRunId?: string;
  /** 管理端重跑时强制走 Agentic，不能被歧义澄清分支改成 Simple。 */
  forceAgenticRoute?: boolean;
  vectorSearch?: boolean;
  /** 旧版 Simple 自适应向量参数，仅保留调用兼容。 */
  adaptiveVectorSearch?: boolean;
  /** Simple 链路启用受治理 受治理知识卡直答。 */
  governedDirectAnswer?: boolean;
  /** 当前会话附件经所有者和会话校验后的临时证据。 */
  supplementalEvidence?: RetrievedChunk[];
  /** 交互式 Simple 生成使用 fast model，减少首 token 等待。 */
  preferFastModel?: boolean;
  /** Auto 通过充分性门禁后复用 Base Case、正式检索与 Obsidian 快照。 */
  prefetchedFastPath?: PrefetchedFastPath;
  /** 语义路由认为需要综合多个片段做整体总结/综述/介绍。 */
  needsSynthesis?: boolean;
  /** 语义路由识别出的实体，用于人物/实体类证据归纳。 */
  entities?: string[];
  /** 单次请求已经完成的语义决策；下游只能复用，不能重新分类。 */
  queryIntent?: unknown;
  /** 单次请求唯一的结构化查询计划；下游禁止重新分类。 */
  queryPlan?: QueryPlan;
  /** 后端策略层生成的执行计划，包含查询、权重、Scope 和图检索开关。 */
  executionPlan?: RetrievalExecutionPlan;
  /** ChatService 构造的统一请求上下文。 */
  requestContext?: RequestContext;
  scope?: RetrievalScope;
  profile?: RetrievalProfile;
  /** 可选插件组合传入的运行时工具白名单。 */
  pluginKeys?: string[];
  pluginTools?: string[];
}
