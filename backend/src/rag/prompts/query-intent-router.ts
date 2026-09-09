import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';

export const queryIntentSchema = z.object({
  intent: z.enum([
    'system_capability',
    'objective_fact',
    'follow_up',
    'project_knowledge',
    'realtime',
    'task_execution',
    'general',
  ]),
  confidence: z.number().min(0).max(1),
  standaloneQuery: z.string().trim().max(1000).optional(),
  ambiguity: z
    .object({
      detected: z.boolean().default(false),
      confidence: z.number().min(0).max(1).default(1),
      senses: z.array(z.string().trim().min(1)).max(5).default([]),
      clarificationQuestion: z.string().trim().max(300).optional(),
    })
    .default({ detected: false, confidence: 1, senses: [] }),
});

export type QueryIntent = z.infer<typeof queryIntentSchema>;

const ROUTER_PROMPT = `你是问答系统的意图路由器，只分析当前用户问题，不读取历史对话、知识库或记忆。
返回 JSON：{"intent":"...","confidence":0到1之间的小数,"standaloneQuery":"可独立检索的问题"}。
同时返回 ambiguity：是否存在多义词、候选语义和必要时的澄清问题。对于仅含实体名的短查询，先依据常见用法判断是否存在主流指代：有主流指代时判为 objective_fact，系统会直接解释并可简要说明其他含义；只有多个语义同等合理、无法判断主流指代时才 detected=true。不要因为知识库里出现多个同名结果就判为多义，也不要因为输入短就要求用户补充。
意图定义：
- system_capability：询问你是什么模型、当前使用的模型、模型系列、支持哪些输入或能力、上下文限制
- objective_fact：数学、技术定义、科学或通识事实
- follow_up：依赖上一轮指代、上下文或继续当前任务
- project_knowledge：询问项目、公司、业务资料或已上传文档
- realtime：询问最新、当前变化、价格、天气、新闻或其他时效性信息
- task_execution：要求写代码、生成文档、执行方案或调用工具
- general：无法归入以上类别的普通问题
判定边界：稳定的通用事实（如基础算式、React 的通用定义）不需要知识库；涉及“我们项目／公司／文档／当前版本／线上数据”的问题必须检索；最新、价格、天气、新闻等时效性问题必须走实时检索；要求基于已上传资料执行任务时必须检索；无法确定时不要把项目问题判为 objective_fact。
若问题依赖“上次／刚才／这个”等指代，standaloneQuery 用当前问题和可见的实体改写；没有指代时原样保留。只输出 JSON，不解释分类过程。`;

@Injectable()
export class QueryIntentRouter {
  private readonly logger = new Logger(QueryIntentRouter.name);

  constructor(private readonly llmProvider: LlmProvider) {}

  async classify(query: string): Promise<QueryIntent> {
    try {
      // 避免 withStructuredOutput 触发 provider 的工具调用／重试，直接要求最小 JSON 响应并本地校验。
      const content = await this.withTimeout(
        this.llmProvider.invoke(
          `${ROUTER_PROMPT}\n\n当前用户问题：${query.trim()}\n只输出一个合法 JSON 对象。`,
        ),
        20_000,
      );
      return queryIntentSchema.parse(this.parseJson(content));
    } catch (error) {
      this.logger.warn(
        `Semantic routing failed: ${(error as Error).message}`,
      );
      return this.safeFallback(query);
    }
  }

  private parseJson(content: string): unknown {
    const candidate = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('semantic router returned non-JSON');
    return JSON.parse(candidate.slice(start, end + 1));
  }

  private safeFallback(query: string): QueryIntent {
    const text = query.trim();
    if (/模型|多模态|图片|音频|视频|能力|上下文限制|知识截止/.test(text)) {
      return { intent: 'system_capability', confidence: 0.86, standaloneQuery: text, ambiguity: { detected: false, confidence: 1, senses: [] } };
    }
    if (/\d+\s*[+\-*/×÷]\s*\d+/.test(text)) {
      return { intent: 'objective_fact', confidence: 0.9, standaloneQuery: text, ambiguity: { detected: false, confidence: 1, senses: [] } };
    }
    return { intent: 'general', confidence: 0.4, standaloneQuery: text, ambiguity: { detected: false, confidence: 0.6, senses: [] } };
  }


  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('query intent timeout')), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
