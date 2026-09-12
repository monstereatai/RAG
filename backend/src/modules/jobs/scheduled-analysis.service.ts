import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { AgentTaskEntity } from '../../providers/db/entities/agent-task.entity';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { QueryLogEntity } from '../../providers/db/entities/query-log.entity';
import { RagFeedbackEntity } from '../../providers/db/entities/rag-feedback.entity';
import { ScheduledJobEntity } from '../../providers/db/entities/job.entity';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import type {
  AnalysisDataScope,
  ParsedScheduledAnalysis,
  ScheduledAnalysisConfig,
  ScheduledJobSourceType,
} from './job.types';

type AnalysisSnapshot = {
  period: { start: string; end: string; window: string };
  rules?: Array<Record<string, unknown>>;
  complaints?: {
    total: number;
    byType: Record<string, number>;
    samples: Array<Record<string, unknown>>;
  };
  qa?: Record<string, number>;
  workflow?: {
    total: number;
    byRole: Record<string, number>;
    byStatus: Record<string, number>;
  };
};

@Injectable()
export class ScheduledAnalysisService {
  private readonly logger = new Logger(ScheduledAnalysisService.name);

  constructor(
    @InjectRepository(DocumentMetaEntity)
    private readonly documentRepo: Repository<DocumentMetaEntity>,
    @InjectRepository(RagFeedbackEntity)
    private readonly feedbackRepo: Repository<RagFeedbackEntity>,
    @InjectRepository(QueryLogEntity)
    private readonly queryLogRepo: Repository<QueryLogEntity>,
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    private readonly llmProvider: LlmProvider,
    private readonly langfuseProvider: LangfuseProvider,
  ) {}

  parseDefinition(
    sourceText: string,
    sourceType: ScheduledJobSourceType,
  ): ParsedScheduledAnalysis {
    const text = sourceText.trim();
    const dataScopes = this.detectDataScopes(text);
    const roles = this.detectValues(text, [
      '产品',
      '设计',
      '前端',
      '后端',
      '测试',
      '运营',
      '客服',
      '研发',
    ]);
    const departments = this.detectValues(text, [
      '产品部',
      '设计部',
      '研发部',
      '测试部',
      '运营部',
      '客服部',
      '市场部',
    ]);
    const schedule = this.detectSchedule(text);
    const effectiveDataScopes: AnalysisDataScope[] = dataScopes.length
      ? dataScopes
      : ['rules', 'complaints', 'qa', 'workflow'];
    return {
      name: this.detectName(text, sourceType),
      ...schedule,
      sourceType,
      instruction: text,
      analysisConfig: {
        window:
          text.includes('本月') || text.includes('这个月')
            ? 'month'
            : text.includes('本周') || text.includes('这周')
              ? 'week'
              : 'today',
        dataScopes: effectiveDataScopes,
        roles,
        departments: departments.length
          ? departments
          : this.defaultDepartments(effectiveDataScopes),
      },
    };
  }

  async execute(job: ScheduledJobEntity): Promise<{
    markdown: string;
    snapshot: AnalysisSnapshot;
  }> {
    const config = this.parseConfig(job.analysisConfig);
    const range = this.resolveRange(config.window);
    const snapshot = await this.collectSnapshot(config, range.start, range.end);
    const deterministic = this.renderMetrics(job, config, snapshot);
    try {
      const model = this.llmProvider.getModel();
      const response = await model.invoke([
        {
          role: 'system',
          content: [
            '你是企业运营数据分析 Agent。只能依据给定统计快照生成 Markdown 报告，不得编造数量、客户、规则或部门事实。',
            '报告必须包含：执行范围、关键统计、异常与趋势、岗位建议、部门建议、待人工确认、数据来源说明。',
            '投诉数据来自系统负反馈代理指标，除非快照明确提供，不得声称它等于真实客服工单总量。',
            '建议要对应快照中的证据；数据不足时明确写“数据不足”。',
            '禁止补充快照中不存在的系统版本、行业基准、SLA、百分比、截止时间、用户身份或数据来源。',
            '禁止给建议编号；报告中出现的任何数字都必须原样来自统计快照。',
          ].join('\n'),
        },
        {
          role: 'human',
          content: [
            `任务名称：${job.name ?? '运营分析任务'}`,
            `原始任务定义：\n${job.instruction.slice(0, 6_000)}`,
            `关注岗位：${config.roles.join('、') || '未指定'}`,
            `关注部门：${config.departments.join('、') || '未指定'}`,
            `统计快照：\n${JSON.stringify(snapshot).slice(0, 20_000)}`,
          ].join('\n\n'),
        },
      ]);
      const generated =
        typeof response.content === 'string'
          ? response.content.trim()
          : JSON.stringify(response.content);
      if (generated && this.isGroundedGenerated(generated, snapshot)) {
        const markdown = `${deterministic}\n\n## Agent 分析与建议\n\n${generated}`;
        await this.trace(job, config, snapshot, markdown);
        return {
          markdown,
          snapshot,
        };
      }
      if (generated) {
        this.logger.warn(
          `Scheduled analysis generation rejected by evidence gate: job=${job.id}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Scheduled analysis LLM generation failed: ${(error as Error).message}`,
      );
    }
    const markdown = `${deterministic}\n\n${this.renderFallbackSuggestions(config, snapshot)}`;
    await this.trace(job, config, snapshot, markdown);
    return {
      markdown,
      snapshot,
    };
  }

  private async trace(
    job: ScheduledJobEntity,
    config: ScheduledAnalysisConfig,
    snapshot: AnalysisSnapshot,
    report: string,
  ): Promise<void> {
    await this.langfuseProvider.traceScheduledAnalysis({
      jobId: job.id,
      userId: job.userId ?? undefined,
      name: job.name ?? '运营分析任务',
      instruction: job.instruction.slice(0, 6_000),
      window: config.window,
      dataScopes: config.dataScopes,
      snapshotCounts: {
        rules: snapshot.rules?.length ?? 0,
        complaintsProxy: snapshot.complaints?.total ?? 0,
        qa: snapshot.qa?.totalQueries ?? 0,
        workflow: snapshot.workflow?.total ?? 0,
      },
      report: report.slice(0, 20_000),
    });
  }

  private async collectSnapshot(
    config: ScheduledAnalysisConfig,
    start: Date,
    end: Date,
  ): Promise<AnalysisSnapshot> {
    const scopes = new Set(config.dataScopes);
    const [rules, feedback, queries, tasks] = await Promise.all([
      scopes.has('rules')
        ? this.documentRepo
            .createQueryBuilder('document')
            .where('document."createdAt" BETWEEN :start AND :end', {
              start,
              end,
            })
            .orWhere('document."effectiveAt" BETWEEN :start AND :end', {
              start,
              end,
            })
            .orderBy('document."createdAt"', 'DESC')
            .take(100)
            .getMany()
        : Promise.resolve([]),
      scopes.has('complaints')
        ? this.feedbackRepo.find({
            where: { feedback: 'negative', createdAt: Between(start, end) },
            order: { createdAt: 'DESC' },
            take: 500,
          })
        : Promise.resolve([]),
      scopes.has('qa') || scopes.has('complaints')
        ? this.queryLogRepo.find({
            where: { createdAt: Between(start, end) },
            order: { createdAt: 'DESC' },
            take: 1000,
          })
        : Promise.resolve([]),
      scopes.has('workflow')
        ? this.taskRepo.find({
            where: { createdAt: Between(start, end) },
            order: { createdAt: 'DESC' },
            take: 500,
          })
        : Promise.resolve([]),
    ]);

    const snapshot: AnalysisSnapshot = {
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        window: config.window,
      },
    };
    if (scopes.has('rules')) {
      snapshot.rules = rules.map((item) => ({
        docId: item.docId,
        title: item.title ?? item.filename,
        version: item.docVersion,
        lifecycleStatus: item.lifecycleStatus,
        effectiveAt: item.effectiveAt,
        sourceAuthority: item.sourceAuthority,
      }));
    }
    if (scopes.has('complaints')) {
      const queryById = new Map(queries.map((item) => [item.id, item.query]));
      snapshot.complaints = {
        total: feedback.length,
        byType: this.countBy(feedback, (item) => item.errorType ?? '未分类'),
        samples: feedback.slice(0, 30).map((item) => ({
          errorType: item.errorType ?? '未分类',
          query: item.queryLogId
            ? (queryById.get(item.queryLogId) ?? '原问题不可用')
            : '原问题不可用',
          comment: item.comment?.slice(0, 300) ?? '',
          status: item.status,
        })),
      };
    }
    if (scopes.has('qa')) {
      const answered = queries.filter((item) => item.hasAnswer).length;
      snapshot.qa = {
        totalQueries: queries.length,
        answered,
        refused: queries.filter((item) => item.refused).length,
        zeroCitation: queries.filter((item) => item.citationCount === 0).length,
        averageLatencyMs: queries.length
          ? Math.round(
              queries.reduce((sum, item) => sum + item.latencyMs, 0) /
                queries.length,
            )
          : 0,
      };
    }
    if (scopes.has('workflow')) {
      snapshot.workflow = {
        total: tasks.length,
        byRole: this.countBy(tasks, (item) => item.role),
        byStatus: this.countBy(tasks, (item) => item.status),
      };
    }
    return snapshot;
  }

  private renderMetrics(
    job: ScheduledJobEntity,
    config: ScheduledAnalysisConfig,
    snapshot: AnalysisSnapshot,
  ): string {
    const lines = [
      `# ${job.name ?? '运营分析定时报告'}`,
      '',
      `- 执行时间：${this.formatLocalTime(new Date())}`,
      `- 统计范围：${this.formatLocalTime(new Date(snapshot.period.start))} 至 ${this.formatLocalTime(new Date(snapshot.period.end))}`,
      `- 数据范围：${config.dataScopes.join('、')}`,
      '',
      '## 可复核统计',
      '',
    ];
    if (snapshot.rules)
      lines.push(`- 新增／生效规则文档：${snapshot.rules.length} 条`);
    if (snapshot.complaints)
      lines.push(`- 投诉代理指标（负反馈）：${snapshot.complaints.total} 条`);
    if (snapshot.qa) {
      lines.push(
        `- 问答：${snapshot.qa.totalQueries} 次；拒答：${snapshot.qa.refused} 次；零引用：${snapshot.qa.zeroCitation} 次；平均延迟：${snapshot.qa.averageLatencyMs} ms`,
      );
    }
    if (snapshot.workflow)
      lines.push(`- 产研运子任务：${snapshot.workflow.total} 个`);
    return lines.join('\n');
  }

  private renderFallbackSuggestions(
    config: ScheduledAnalysisConfig,
    snapshot: AnalysisSnapshot,
  ): string {
    return [
      '## 规则化建议（模型不可用时降级）',
      '',
      snapshot.rules?.length
        ? '- 产品／运营：逐条确认新规则的生效范围、旧版本废弃状态和通知对象。'
        : '- 规则：本统计窗口没有发现新增或生效文档。',
      snapshot.complaints?.total
        ? '- 客服／产品：优先复核高频错误类型，并把确认后的问题进入 Bad Case 审核和回归集。'
        : '- 投诉代理指标：本统计窗口没有负反馈样本。',
      snapshot.qa && snapshot.qa.zeroCitation > 0
        ? '- 研发／知识运营：抽查零引用回答，区分知识缺失、权限过滤和检索失败。'
        : '- 问答质量：暂无需要基于规则触发的零引用专项。',
      `- 关注岗位：${config.roles.join('、') || '未指定，需人工分派'}`,
      `- 关注部门：${config.departments.join('、') || '未指定，需人工分派'}`,
    ].join('\n');
  }

  private parseConfig(raw: string | null | undefined): ScheduledAnalysisConfig {
    try {
      const parsed = JSON.parse(
        raw || '{}',
      ) as Partial<ScheduledAnalysisConfig>;
      return {
        window: ['today', 'week', 'month'].includes(String(parsed.window))
          ? (parsed.window as ScheduledAnalysisConfig['window'])
          : 'today',
        dataScopes:
          Array.isArray(parsed.dataScopes) && parsed.dataScopes.length
            ? parsed.dataScopes
            : ['rules', 'complaints', 'qa', 'workflow'],
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
        departments: Array.isArray(parsed.departments)
          ? parsed.departments
          : [],
      };
    } catch {
      return {
        window: 'today',
        dataScopes: ['rules', 'complaints', 'qa', 'workflow'],
        roles: [],
        departments: [],
      };
    }
  }

  private resolveRange(window: ScheduledAnalysisConfig['window']): {
    start: Date;
    end: Date;
  } {
    const end = new Date();
    const start = new Date(end);
    if (window === 'month') {
      start.setDate(1);
    } else if (window === 'week') {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
    }
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  private detectDataScopes(text: string): AnalysisDataScope[] {
    const result: AnalysisDataScope[] = [];
    if (/规则|规范|文档|版本/.test(text)) result.push('rules');
    if (/投诉|客诉|负反馈|bad\s*case/i.test(text)) result.push('complaints');
    if (/问答|引用|拒答|召回|查询/.test(text)) result.push('qa');
    if (/工作流|岗位|部门|任务|交付|审批/.test(text)) result.push('workflow');
    return [...new Set(result)];
  }

  private isGroundedGenerated(
    generated: string,
    snapshot: AnalysisSnapshot,
  ): boolean {
    if (
      /真实用户|行业|基准|SLA|截止|小时内|分钟内|系统版本|版本号|下次执行|必须暂停/i.test(
        generated,
      )
    ) {
      return false;
    }
    const allowedNumbers = new Set(
      (JSON.stringify(snapshot).match(/\d+(?:\.\d+)?/g) ?? []).map(Number),
    );
    return (generated.match(/\d+(?:\.\d+)?/g) ?? []).every((value) =>
      allowedNumbers.has(Number(value)),
    );
  }

  private formatLocalTime(value: Date): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(value);
  }

  private detectSchedule(
    text: string,
  ): Pick<ParsedScheduledAnalysis, 'type' | 'cron' | 'everyMs'> {
    const intervalMatch = text.match(
      /每隔\s*(\d+(?:\.\d+)?)\s*(分钟|分|小时|小时钟|时|天)/,
    );
    if (intervalMatch) {
      const amount = Number(intervalMatch[1]);
      const unit = intervalMatch[2];
      const multiplier =
        unit === '天' ? 86_400_000 : unit.includes('时') ? 3_600_000 : 60_000;
      const everyMs = Math.round(amount * multiplier);
      if (!Number.isFinite(everyMs) || everyMs < 1_000) {
        throw new BadRequestException(
          '无法解析有效的间隔时间，最小间隔为 1 秒',
        );
      }
      return { type: 'every', everyMs };
    }

    const timeMatches = [
      ...text.matchAll(
        /(上午|早上|下午|晚上|夜间|凌晨|中午)?\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2})|\s*(?:点|时)(?:\s*(半|\d{1,2})\s*分?)?)/g,
      ),
    ];
    const timeMatch = timeMatches.at(-1);
    if (!timeMatch) {
      throw new BadRequestException(
        '未识别到明确的执行时间，请补充例如“每天上午 9 点”或“每隔 2 小时”',
      );
    }
    const period = timeMatch[1];
    let hour = Number(timeMatch[2]);
    const minuteText = timeMatch[3] ?? timeMatch[4];
    const minute = minuteText === '半' ? 30 : Number(minuteText ?? 0);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new BadRequestException('执行小时必须在 0 到 23 之间');
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new BadRequestException('执行分钟必须在 0 到 59 之间');
    }
    if (period === '下午' || period === '晚上' || period === '夜间') {
      if (hour < 12) hour += 12;
    } else if (period === '凌晨' && hour === 12) {
      hour = 0;
    } else if (period === '中午' && hour < 11) {
      hour += 12;
    }
    if (/每月/.test(text)) {
      const day = Math.min(
        Math.max(Number(text.match(/每月\s*(\d{1,2})[号日]?/)?.[1] ?? 1), 1),
        31,
      );
      return { type: 'cron', cron: `${minute} ${hour} ${day} * *` };
    }
    if (/每个?工作日|工作日/.test(text)) {
      return { type: 'cron', cron: `${minute} ${hour} * * 1-5` };
    }
    if (/每个?周末|周末/.test(text)) {
      return { type: 'cron', cron: `${minute} ${hour} * * 0,6` };
    }
    const weekMatch = text.match(/每周([一二三四五六日天])/);
    if (weekMatch) {
      const weekMap: Record<string, number> = {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        日: 0,
        天: 0,
      };
      return {
        type: 'cron',
        cron: `${minute} ${hour} * * ${weekMap[weekMatch[1]]}`,
      };
    }
    if (/每天|每日|天天/.test(text)) {
      return { type: 'cron', cron: `${minute} ${hour} * * *` };
    }
    throw new BadRequestException(
      '未识别到明确的执行周期，请补充“每天、每周、每月、工作日”或“每隔”',
    );
  }

  private detectName(text: string, sourceType: ScheduledJobSourceType): string {
    const heading =
      sourceType === 'markdown' ? text.match(/^#\s+(.+)$/m)?.[1] : undefined;
    const firstLine =
      heading ?? text.split('\n').find((line) => line.trim()) ?? '运营分析任务';
    return firstLine
      .replace(/^[-#*\s]+/, '')
      .trim()
      .slice(0, 80);
  }

  private detectValues(text: string, candidates: string[]): string[] {
    return candidates.filter((item) => text.includes(item));
  }

  private defaultDepartments(scopes: AnalysisDataScope[]): string[] {
    const values = new Set<string>();
    if (scopes.includes('rules'))
      ['产品部', '研发部', '测试部', '运营部'].forEach((item) =>
        values.add(item),
      );
    if (scopes.includes('complaints'))
      ['客服部', '产品部', '运营部'].forEach((item) => values.add(item));
    if (scopes.includes('qa'))
      ['研发部', '运营部'].forEach((item) => values.add(item));
    return [...values];
  }

  private countBy<T>(
    items: T[],
    selector: (item: T) => string,
  ): Record<string, number> {
    return items.reduce<Record<string, number>>((result, item) => {
      const key = selector(item) || '未分类';
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
  }
}
