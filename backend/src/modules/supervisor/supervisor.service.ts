import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { AgentPipelineService } from '../../rag/agents/agent-pipeline.service';
import { z } from 'zod';

/**
 * 领域定义
 */
export interface DomainConfig {
  name: string;
  /** 领域中文描述 */
  description: string;
  /** 关键词列表（用于快速分类） */
  keywords: string[];
  /** 使用的 Agent 管线（如果不同领域需要不同的 Agent 子集） */
  pipeline: string[];
  /** 系统提示词前缀 */
  systemPrefix: string;
}

export interface SupervisorResult {
  domain: string;
  answer: string;
  confidence: number;
  stages: Array<{ agent: string; durationMs: number; confidence: number }>;
  totalDurationMs: number;
}

@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  /** 已注册的领域配置 */
  private readonly domains: DomainConfig[] = [
    {
      name: 'tech',
      description: '技术/编程/架构/工程',
      keywords: [
        '代码',
        '编程',
        '架构',
        'API',
        '数据库',
        '前端',
        '后端',
        '部署',
        'Docker',
        'bug',
        '技术',
        '框架',
        '算法',
        '开发',
      ],
      pipeline: ['researcher', 'analyst', 'writer', 'critic', 'editor'],
      systemPrefix: '你是一位资深技术顾问，擅长软件工程和系统架构。',
    },
    {
      name: 'hr',
      description: '人力资源/招聘/绩效/培训',
      keywords: [
        '招聘',
        '面试',
        '绩效',
        '培训',
        '薪酬',
        '员工',
        '团队',
        '人事',
        'HR',
        '入职',
        '离职',
        '考核',
      ],
      pipeline: ['researcher', 'analyst', 'writer'],
      systemPrefix: '你是一位资深 HR 顾问，擅长人力资源管理和组织发展。',
    },
    {
      name: 'finance',
      description: '财务/预算/报表/税务',
      keywords: [
        '预算',
        '财务',
        '报表',
        '税务',
        '成本',
        '利润',
        '审计',
        '发票',
        '报销',
        '资金',
        '投资',
      ],
      pipeline: ['researcher', 'analyst', 'writer', 'critic'],
      systemPrefix: '你是一位资深财务顾问，擅长企业财务管理和分析。',
    },
    {
      name: 'legal',
      description: '法务/合同/合规/知识产权',
      keywords: [
        '合同',
        '法律',
        '合规',
        '专利',
        '知识产权',
        '诉讼',
        '法务',
        '条款',
        '版权',
        '隐私',
      ],
      pipeline: ['researcher', 'analyst', 'writer', 'critic', 'editor'],
      systemPrefix: '你是一位资深法律顾问，擅长企业法务和合规。',
    },
  ];

  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly agentPipeline: AgentPipelineService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Supervisor 入口：自动路由到合适领域 → 执行对应 Agent 管线
   */
  async query(task: string, signal?: AbortSignal): Promise<SupervisorResult> {
    signal?.throwIfAborted();
    const start = Date.now();
    const timeoutMs = Math.min(
      Math.max(
        Number(this.config.get<number>('supervisor.timeoutMs') ?? 120_000),
        1_000,
      ),
      900_000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error(`Supervisor timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal) {
      signal.addEventListener('abort', forwardAbort, { once: true });
    }
    let rejectOnAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = () =>
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error('Supervisor 已取消'),
        );
      if (controller.signal.aborted) rejectOnAbort();
      else
        controller.signal.addEventListener('abort', rejectOnAbort, {
          once: true,
        });
    });

    try {
      // 1. 领域路由
      return await Promise.race([
        (async () => {
          const domain = await this.routeToDomain(task, controller.signal);
          this.logger.log(
            `Routed to domain: ${domain.name} (${domain.description})`,
          );

          // 2. 执行该领域的 Agent 管线
          const pipelineResult = await this.agentPipeline.runPartial(
            task,
            domain.pipeline,
            undefined,
            controller.signal,
          );

          return {
            domain: domain.name,
            answer: pipelineResult.finalOutput ?? '',
            confidence: pipelineResult.overallConfidence,
            stages: pipelineResult.stages.map((s) => ({
              agent: s.agent,
              durationMs: s.durationMs,
              confidence: s.confidence,
            })),
            totalDurationMs: Date.now() - start,
          };
        })(),
        aborted,
      ]);
    } finally {
      clearTimeout(timeout);
      if (rejectOnAbort)
        controller.signal.removeEventListener('abort', rejectOnAbort);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  /**
   * 领域路由：先用关键词快速匹配，再用 LLM 分类
   */
  private async routeToDomain(
    task: string,
    signal?: AbortSignal,
  ): Promise<DomainConfig> {
    signal?.throwIfAborted();
    // 关键词快速匹配
    const keywordMatch = this.matchByKeywords(task);
    if (keywordMatch) {
      this.logger.log(`Domain matched by keywords: ${keywordMatch.name}`);
      return keywordMatch;
    }

    // LLM 分类
    return this.classifyByLlm(task, signal);
  }

  private matchByKeywords(task: string): DomainConfig | null {
    const lower = task.toLowerCase();
    let bestMatch: DomainConfig | null = null;
    let bestScore = 0;

    for (const domain of this.domains) {
      const score = domain.keywords.filter((kw) =>
        lower.includes(kw.toLowerCase()),
      ).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = domain;
      }
    }

    return bestScore >= 2 ? bestMatch : null;
  }

  private async classifyByLlm(
    task: string,
    signal?: AbortSignal,
  ): Promise<DomainConfig> {
    const model = this.llmProvider.getModel();
    const domainNames = this.domains.map((d) => d.name);

    const schema = z.object({
      domain: z
        .enum(domainNames as [string, ...string[]])
        .describe('最匹配的领域'),
      reason: z.string().describe('分类理由'),
    });

    try {
      const structured = model.withStructuredOutput(schema);
      const result = await structured.invoke(
        [
          {
            role: 'system',
            content: `你是一个智能路由器。根据用户问题判断它属于哪个领域。
可选领域：
${this.domains.map((d) => `- ${d.name}：${d.description}`).join('\n')}`,
          },
          { role: 'user', content: task },
        ],
        { signal },
      );

      const matched = this.domains.find((d) => d.name === result.domain);
      if (matched) {
        this.logger.log(
          `Domain classified by LLM: ${matched.name}, reason: ${result.reason}`,
        );
        return matched;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      this.logger.warn(
        `LLM domain classification failed: ${(err as Error).message}`,
      );
    }

    // 默认回退到 tech
    return this.domains[0];
  }

  /**
   * 列出所有可用领域
   */
  listDomains(): Array<{ name: string; description: string }> {
    return this.domains.map((d) => ({
      name: d.name,
      description: d.description,
    }));
  }
}
