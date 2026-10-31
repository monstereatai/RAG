import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { countTextTokens } from '../document/chunking.util';
import { LlmProvider } from '../../providers/llm/llm.provider';
import {
  getPromptMetadata,
  getPromptVersion,
} from '../../rag/prompts/prompt-registry';
import { AgentEvalDto } from './agent-eval.dto';
import { agentEvalJudgeSystemPrompt } from './agent-eval.prompts';

const judgeSchema = z.object({
  answerAssertions: z.array(
    z.object({ claim: z.string(), supported: z.boolean(), reason: z.string() }),
  ),
  coverageAssertions: z.array(
    z.object({
      requirement: z.string(),
      covered: z.boolean(),
      reason: z.string(),
    }),
  ),
  contextRecallAssertions: z.array(
    z.object({
      expectedClaim: z.string(),
      present: z.boolean(),
      reason: z.string(),
    }),
  ),
  reason: z.string(),
});

const THRESHOLDS = {
  faithfulness: 0.88,
  context_recall: 0.8,
  requirement_coverage: 0.8,
  test_case_structure_completeness: 0.8,
};

type EvaluationStatus = 'evaluated' | 'insufficient_data' | 'not_evaluated';
type JudgeMessages = [
  { role: 'system'; content: string },
  { role: 'user'; content: string },
];

@Injectable()
export class AgentEvalService {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly config: ConfigService,
  ) {}

  async evaluate(input: AgentEvalDto) {
    const structure = this.testCaseStructureCompleteness(
      input.output,
      input.taskType ?? 'general',
    );
    const baseMetrics = {
      faithfulness: null as number | null,
      context_recall: null as number | null,
      requirement_coverage: null as number | null,
      test_case_structure_completeness: structure.score,
    };

    if (input.useJudge !== true) {
      return this.result(
        'not_evaluated',
        null,
        '未启用大模型裁判；结构项检查不代表回答质量评测。',
        baseMetrics,
        structure.missing,
        { available: false, skipped: true },
      );
    }

    const requiredClaims = this.uniqueClaims(input.requiredClaims ?? []);
    const expectedContextClaims = this.uniqueClaims(
      input.expectedContextClaims ?? [],
    );
    const missingGoldens = [
      ...(requiredClaims.length === 0 ? ['答案必须覆盖的标准要求'] : []),
      ...(expectedContextClaims.length === 0
        ? ['检索上下文应包含的标准证据']
        : []),
    ];
    if (missingGoldens.length > 0) {
      return this.result(
        'insufficient_data',
        null,
        `缺少评测标准：${missingGoldens.join('、')}。`,
        baseMetrics,
        structure.missing,
        { available: false, skipped: true },
      );
    }

    const judgeMessages = this.buildJudgeMessages(
      input,
      requiredClaims,
      expectedContextClaims,
    );
    const contextWindowTokens = this.positiveNumber(
      this.config.get<number>('llm.contextWindowTokens'),
      32_768,
    );
    const structuredPolicy = this.llmProvider.getRoutePolicy(
      'structured',
      this.llmProvider.getActiveProviderName(),
    );
    const outputProviders = [
      structuredPolicy.primary,
      structuredPolicy.fallback,
    ].filter(
      (provider): provider is NonNullable<typeof provider> => !!provider,
    );
    const outputReserveTokens = Math.max(
      ...outputProviders.map((provider) =>
        Math.max(
          this.positiveNumber(
            this.config.get<number>(`llm.${provider}.maxTokens`),
            4_096,
          ),
          this.llmProvider.getRoutePolicy('structured', provider).maxTokens,
        ),
      ),
    );
    const safetyMarginTokens = Math.max(
      256,
      Math.ceil(contextWindowTokens * 0.1),
    );
    const maxInputTokens = Math.max(
      0,
      contextWindowTokens - outputReserveTokens - safetyMarginTokens,
    );
    const estimatedInputTokens =
      (await countTextTokens(JSON.stringify(judgeMessages))) + 4;
    if (estimatedInputTokens > maxInputTokens) {
      return this.result(
        'not_evaluated',
        null,
        `评测输入预计 ${estimatedInputTokens} tokens，超过安全上限 ${maxInputTokens} tokens；未调用裁判，也未裁剪证据。`,
        baseMetrics,
        structure.missing,
        {
          available: false,
          skipped: true,
          estimatedInputTokens,
          maxInputTokens,
        },
      );
    }

    let judged: z.infer<typeof judgeSchema>;
    try {
      judged = await this.judge(judgeMessages);
    } catch (error) {
      return this.result(
        'not_evaluated',
        null,
        `大模型裁判不可用：${error instanceof Error ? error.message : String(error)}`,
        baseMetrics,
        structure.missing,
        {
          available: false,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const coverageByRequirement = new Map(
      judged.coverageAssertions.map((item) => [
        this.normalizeClaim(item.requirement),
        item,
      ]),
    );
    const contextByClaim = new Map(
      judged.contextRecallAssertions.map((item) => [
        this.normalizeClaim(item.expectedClaim),
        item,
      ]),
    );
    const assertionsComplete =
      requiredClaims.every((claim) =>
        coverageByRequirement.has(this.normalizeClaim(claim)),
      ) &&
      expectedContextClaims.every((claim) =>
        contextByClaim.has(this.normalizeClaim(claim)),
      ) &&
      (input.output.trim().length === 0 || judged.answerAssertions.length > 0);

    if (!assertionsComplete) {
      return this.result(
        'insufficient_data',
        null,
        '裁判没有逐项返回完整判断，本次不计算通过分数。',
        baseMetrics,
        structure.missing,
        { available: true, ...judged },
      );
    }

    const coverageAssertions = requiredClaims.map(
      (requirement) =>
        coverageByRequirement.get(this.normalizeClaim(requirement))!,
    );
    const contextRecallAssertions = expectedContextClaims.map(
      (expectedClaim) =>
        contextByClaim.get(this.normalizeClaim(expectedClaim))!,
    );
    const faithfulness = input.output.trim()
      ? this.ratio(
          judged.answerAssertions.filter((item) => item.supported).length,
          judged.answerAssertions.length,
        )
      : 0;
    const contextRecall = this.ratio(
      contextRecallAssertions.filter((item) => item.present).length,
      contextRecallAssertions.length,
    );
    const requirementCoverage = this.ratio(
      coverageAssertions.filter((item) => item.covered).length,
      coverageAssertions.length,
    );
    const metrics = {
      faithfulness,
      context_recall: contextRecall,
      requirement_coverage: requirementCoverage,
      test_case_structure_completeness: structure.score,
    };
    const passed =
      faithfulness >= THRESHOLDS.faithfulness &&
      contextRecall >= THRESHOLDS.context_recall &&
      requirementCoverage >= THRESHOLDS.requirement_coverage &&
      (structure.score === null ||
        structure.score >= THRESHOLDS.test_case_structure_completeness);

    return this.result(
      'evaluated',
      passed,
      judged.reason,
      metrics,
      structure.missing,
      {
        available: true,
        answerAssertions: judged.answerAssertions,
        coverageAssertions,
        contextRecallAssertions,
      },
      {
        unsupportedClaims: judged.answerAssertions
          .filter((item) => !item.supported)
          .map((item) => item.claim),
        missingRequirements: coverageAssertions
          .filter((item) => !item.covered)
          .map((item) => item.requirement),
        missingContextClaims: contextRecallAssertions
          .filter((item) => !item.present)
          .map((item) => item.expectedClaim),
      },
    );
  }

  private buildJudgeMessages(
    input: AgentEvalDto,
    requiredClaims: string[],
    expectedContextClaims: string[],
  ): JudgeMessages {
    return [
      {
        role: 'system',
        content: agentEvalJudgeSystemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: input.query,
          contexts: input.contexts,
          answer: input.output,
          requiredClaims,
          expectedContextClaims,
        }),
      },
    ];
  }

  private async judge(
    messages: JudgeMessages,
  ): Promise<z.infer<typeof judgeSchema>> {
    return this.llmProvider
      .getModel()
      .withStructuredOutput(judgeSchema)
      .invoke(messages, { metadata: getPromptMetadata('agent_eval.judge') });
  }

  private positiveNumber(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! > 0 ? value! : fallback;
  }

  private testCaseStructureCompleteness(output: string, taskType: string) {
    if (taskType !== 'test_case')
      return { score: null, missing: [] as string[] };
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
      score: this.ratio(sections.length - missing.length, sections.length),
      missing,
    };
  }

  private uniqueClaims(claims: string[]): string[] {
    const seen = new Set<string>();
    return claims
      .map((claim) => claim.trim())
      .filter((claim) => {
        const key = this.normalizeClaim(claim);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private normalizeClaim(value: string): string {
    return value.toLowerCase().replace(/[\s，,。.!！?？：:；;]/g, '');
  }

  private ratio(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Number((numerator / denominator).toFixed(4));
  }

  private result(
    status: EvaluationStatus,
    passed: boolean | null,
    reason: string,
    metrics: Record<string, number | null>,
    missingTestCaseSections: string[],
    judge: Record<string, unknown>,
    assertions: {
      unsupportedClaims?: string[];
      missingRequirements?: string[];
      missingContextClaims?: string[];
    } = {},
  ) {
    return {
      status,
      passed,
      reason,
      metrics,
      thresholds: THRESHOLDS,
      assertions: {
        unsupportedClaims: assertions.unsupportedClaims ?? [],
        missingRequirements: assertions.missingRequirements ?? [],
        missingContextClaims: assertions.missingContextClaims ?? [],
        missingTestCaseSections,
      },
      judge: {
        ...judge,
        promptVersion: getPromptVersion('agent_eval.judge'),
      },
    };
  }
}
