import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { AgentEvalDto } from './agent-eval.dto';

const judgeSchema = z.object({
  faithfulnessAssertions: z.array(
    z.object({ claim: z.string(), supported: z.boolean(), reason: z.string() }),
  ),
  coverageAssertions: z.array(
    z.object({ requirement: z.string(), covered: z.boolean() }),
  ),
  reason: z.string(),
});

@Injectable()
export class AgentEvalService {
  constructor(private readonly llmProvider: LlmProvider) {}

  async evaluate(input: AgentEvalDto) {
    const faithfulness = this.faithfulness(input.output, input.contexts);
    const contextRecall = this.contextRecall(
      input.contexts,
      input.expectedContextClaims ?? [],
    );
    const coverage = this.coverage(
      input.output,
      input.requiredClaims ?? this.inferRequirements(input.query),
    );
    const testCaseCompleteness = this.testCaseCompleteness(
      input.output,
      input.taskType ?? 'general',
    );
    const stepAccuracy = this.stepAccuracy(
      input.expectedSteps ?? [],
      input.actualSteps ?? [],
    );
    const toolSuccessRate = this.toolSuccessRate(input.toolCalls ?? []);
    const humanHandoffRate = input.humanHandoff ? 1 : 0;
    const taskSuccess =
      faithfulness.score >= 0.88 &&
      coverage.score >= 0.8 &&
      testCaseCompleteness.score >= 0.8 &&
      stepAccuracy >= 0.8 &&
      toolSuccessRate >= 0.9;

    const judge = input.useJudge
      ? await this.judge(input).catch((error) => ({
          available: false,
          error: (error as Error).message,
        }))
      : { available: false, skipped: true };

    return {
      passed: taskSuccess,
      metrics: {
        task_success_rate: taskSuccess ? 1 : 0,
        faithfulness: faithfulness.score,
        context_recall: contextRecall.score,
        prd_coverage: coverage.score,
        test_case_completeness: testCaseCompleteness.score,
        tool_success_rate: toolSuccessRate,
        step_accuracy: stepAccuracy,
        human_handoff_rate: humanHandoffRate,
      },
      assertions: {
        unsupportedClaims: faithfulness.unsupported,
        missingRequirements: coverage.missing,
        missingTestCaseSections: testCaseCompleteness.missing,
        missingContextClaims: contextRecall.missing,
      },
      thresholds: {
        faithfulness: 0.88,
        contextRecall: 0.8,
        prdCoverage: 0.8,
        testCaseCompleteness: 0.8,
        toolSuccessRate: 0.9,
        stepAccuracy: 0.8,
      },
      judge,
    };
  }

  private faithfulness(output: string, contexts: string[]) {
    const evidence = this.normalize(contexts.join('\n'));
    const claims = output
      .split(/[。！？\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8 && !/^#+\s/.test(item));
    if (claims.length === 0) return { score: 1, unsupported: [] as string[] };
    const supported = claims.filter((claim) => {
      const tokens = this.tokens(claim);
      if (tokens.length === 0) return true;
      const matched = tokens.filter((token) => evidence.includes(token)).length;
      return matched / tokens.length >= 0.5;
    });
    const unsupported = claims.filter((claim) => !supported.includes(claim));
    return {
      score: this.round(supported.length / claims.length),
      unsupported,
    };
  }

  private coverage(output: string, requirements: string[]) {
    if (requirements.length === 0) return { score: 1, missing: [] as string[] };
    const normalized = this.normalize(output);
    const missing = requirements.filter(
      (item) => !this.tokens(item).some((token) => normalized.includes(token)),
    );
    return {
      score: this.round(
        (requirements.length - missing.length) / requirements.length,
      ),
      missing,
    };
  }

  private contextRecall(contexts: string[], expectedClaims: string[]) {
    if (expectedClaims.length === 0) {
      return { score: 1, missing: [] as string[] };
    }
    const evidence = this.normalize(contexts.join('\n'));
    const missing = expectedClaims.filter(
      (claim) => !this.tokens(claim).some((token) => evidence.includes(token)),
    );
    return {
      score: this.round(
        (expectedClaims.length - missing.length) / expectedClaims.length,
      ),
      missing,
    };
  }

  private testCaseCompleteness(output: string, taskType: string) {
    if (taskType !== 'test_case') return { score: 1, missing: [] as string[] };
    const sections: Array<[string, RegExp]> = [
      ['前置条件', /前置条件|前提/],
      ['测试步骤', /测试步骤|操作步骤/],
      ['输入', /输入|测试数据/],
      ['预期结果', /预期结果|期望结果/],
      ['边界／异常', /边界|异常|失败场景/],
    ];
    const missing = sections
      .filter(([, pattern]) => !pattern.test(output))
      .map(([name]) => name);
    return {
      score: this.round((sections.length - missing.length) / sections.length),
      missing,
    };
  }

  private stepAccuracy(expected: string[], actual: string[]): number {
    if (expected.length === 0) return 1;
    const correct = expected.filter(
      (step, index) =>
        actual[index] &&
        this.tokens(step).some((token) =>
          this.normalize(actual[index]).includes(token),
        ),
    ).length;
    return this.round(correct / expected.length);
  }

  private toolSuccessRate(calls: Array<{ success: boolean }>): number {
    if (calls.length === 0) return 1;
    return this.round(
      calls.filter((item) => item.success).length / calls.length,
    );
  }

  private inferRequirements(query: string): string[] {
    const candidates = [
      '地区',
      '多语言',
      '合规',
      '版本',
      '权限',
      '异常',
      '回滚',
      '监控',
    ];
    return candidates.filter((item) => query.includes(item));
  }

  private async judge(input: AgentEvalDto) {
    const result = await this.llmProvider
      .getModel()
      .withStructuredOutput(judgeSchema)
      .invoke([
        {
          role: 'system',
          content:
            '你是严格的 Agent 评测员。逐条输出布尔断言，不直接给模糊总分；上下文没有支撑的结论必须标 false。',
        },
        {
          role: 'user',
          content: `问题：${input.query}\n上下文：${JSON.stringify(input.contexts)}\n回答：${input.output}\n要求：${JSON.stringify(input.requiredClaims ?? [])}`,
        },
      ]);
    return { available: true, ...result };
  }

  private tokens(value: string): string[] {
    const normalized = this.normalize(value);
    const words =
      normalized.match(/[a-z0-9_./:-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
    return [
      ...new Set(
        words.flatMap((word) => {
          if (!/[\u4e00-\u9fff]/.test(word) || word.length <= 4) return [word];
          return Array.from({ length: word.length - 1 }, (_, index) =>
            word.slice(index, index + 2),
          );
        }),
      ),
    ];
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '');
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }
}
