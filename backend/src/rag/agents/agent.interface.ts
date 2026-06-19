/**
 * 子 Agent 抽象接口
 *
 * 每个子 Agent 专注于一个职责：
 *   - Researcher：检索收集信息
 *   - Analyst：分析推理数据
 *   - Writer：撰写生成内容
 *   - Critic：评审质检
 *   - Editor：编辑润色
 */
export interface AgentInput {
  /** 任务描述 / 用户原始问题 */
  task: string;
  /** 上下文信息（前序 Agent 的输出或外部数据） */
  context?: string;
  /** 对话历史 */
  history?: Array<{ role: 'human' | 'ai'; content: string }>;
  /** 额外配置 */
  metadata?: Record<string, unknown>;
}

export interface AgentOutput {
  /** Agent 输出内容 */
  content: string;
  /** Agent 名称标识 */
  agent: string;
  /** 置信度 0~1 */
  confidence: number;
  /** 执行耗时(ms) */
  durationMs: number;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

export interface ISubAgent {
  /** Agent 名称 */
  readonly name: string;
  /** Agent 角色描述 */
  readonly role: string;
  /** 执行任务 */
  execute(input: AgentInput): Promise<AgentOutput>;
}

/**
 * 子 Agent 编排管线状态
 */
export interface AgentPipelineState {
  /** 原始任务 */
  task: string;
  /** 各阶段 Agent 输出 */
  stages: AgentOutput[];
  /** 最终整合输出 */
  finalOutput?: string;
  /** 整体置信度 */
  overallConfidence: number;
}
