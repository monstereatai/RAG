import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
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
});

export type QueryIntent = z.infer<typeof queryIntentSchema>;

const ROUTER_PROMPT = `你是问答系统的意图路由器，只分析当前用户问题，不读取历史对话、知识库或记忆。
返回 JSON：{"intent":"...","confidence":0到1之间的小数}。
意图定义：
- system_capability：询问你是什么模型、当前使用的模型、模型系列、支持哪些输入或能力、上下文限制
- objective_fact：数学、技术定义、科学或通识事实
- follow_up：依赖上一轮指代、上下文或继续当前任务
- project_knowledge：询问项目、公司、业务资料或已上传文档
- realtime：询问最新、当前变化、价格、天气、新闻或其他时效性信息
- task_execution：要求写代码、生成文档、执行方案或调用工具
- general：无法归入以上类别的普通问题
判定边界：稳定的通用事实（如基础算式、React 的通用定义）不需要知识库；涉及“我们项目／公司／文档／当前版本／线上数据”的问题必须检索；最新、价格、天气、新闻等时效性问题必须走实时检索；要求基于已上传资料执行任务时必须检索；无法确定时不要把项目问题判为 objective_fact。
只输出 JSON，不解释分类过程。`;

@Injectable()
export class QueryIntentRouter {
  constructor(private readonly llmProvider: LlmProvider) {}

  async classify(query: string): Promise<QueryIntent> {
    try {
      const classifier = this.llmProvider
        .getModel()
        .withStructuredOutput(queryIntentSchema);
      const result = await this.withTimeout(
        classifier.invoke([
          new SystemMessage(ROUTER_PROMPT),
          new HumanMessage(query.trim()),
        ]),
        800,
      );
      return queryIntentSchema.parse(result);
    } catch {
      return this.safeFallback(query);
    }
  }

  private safeFallback(query: string): QueryIntent {
    const text = query.trim();
    if (/模型|多模态|图片|音频|视频|能力|上下文限制|知识截止/.test(text)) {
      return { intent: 'system_capability', confidence: 0.86 };
    }
    if (
      (/[?？]$/.test(text) && /是什么|何谓|定义|等于几|多少/.test(text)) ||
      /\d+\s*[+\-*/×÷]\s*\d+/.test(text)
    ) {
      return { intent: 'objective_fact', confidence: 0.9 };
    }
    return { intent: 'general', confidence: 0.4 };
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
