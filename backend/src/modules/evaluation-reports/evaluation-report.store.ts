import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface EvaluationReportSummary {
  datasetName: string;
  mode: string;
  passed: boolean;
  averageScore: number;
  totalSamples: number;
  refusalRate: number;
  citationRate: number;
  available?: boolean;
  lastRunAt?: string;
  source?: string;
  reason?: string;
  outcome?: 'passed' | 'failed' | 'skipped' | 'unavailable';
  failedSamples?: number;
}

const REPORTS = [
  {
    datasetName: 'agent-platform',
    mode: 'offline',
    file: 'agent-platform-latest.json',
  },
  {
    datasetName: 'golden-business',
    mode: 'offline/live',
    file: 'golden-business-latest.json',
  },
  {
    datasetName: 'bad-case-regression',
    mode: 'simple/auto/agentic',
    file: 'bad-case-regression.json',
  },
  {
    datasetName: 'query-routing',
    mode: 'offline-contract',
    file: 'query-routing-latest.json',
  },
] as const;

export function readEvaluationReportSummaries(): EvaluationReportSummary[] {
  const reportDir = path.resolve(
    process.env.RAG_EVAL_REPORT_DIR ??
      process.env.EVAL_REPORT_DIR ??
      path.join(process.cwd(), '.tmp/evidence'),
  );
  return REPORTS.map((definition) => {
    const filePath = path.join(reportDir, definition.file);
    if (!existsSync(filePath)) {
      return unavailable(definition, '尚未生成评测报告');
    }
    try {
      const report = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
        string,
        unknown
      >;
      const normalized = normalizeReport(definition, report);
      return {
        datasetName: definition.datasetName,
        ...normalized,
        available: true,
        lastRunAt: stringValue(report.generatedAt),
        source: 'report-file',
      };
    } catch (error) {
      return unavailable(
        definition,
        `报告解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function unavailable(
  definition: (typeof REPORTS)[number],
  reason: string,
): EvaluationReportSummary {
  return {
    datasetName: definition.datasetName,
    mode: definition.mode,
    passed: false,
    averageScore: 0,
    totalSamples: 0,
    refusalRate: 0,
    citationRate: 0,
    available: false,
    source: 'report-file',
    reason,
    outcome: 'unavailable',
    failedSamples: 0,
  };
}

function normalizeReport(
  definition: (typeof REPORTS)[number],
  report: Record<string, unknown>,
): Omit<EvaluationReportSummary, 'datasetName' | 'available' | 'lastRunAt' | 'source'> {
  // golden-business 的离线文件只证明数据集结构和样本可读，不能冒充真实问答通过。
  // 之前直接读取 ok:true，导致后台同时显示“通过”和 86 个失败样本。
  if (definition.datasetName === 'golden-business' && report.live !== true) {
    const caseCount = numberValue(report.caseCount ?? report.total ?? report.cases);
    const validationFailed = report.ok === false;
    return {
      mode: definition.mode,
      passed: false,
      averageScore: 0,
      totalSamples: caseCount,
      refusalRate: 0,
      citationRate: 0,
      reason: validationFailed
        ? stringValue(report.reason) ?? '数据集结构校验失败'
        : '仅完成数据集结构校验，未执行真实问答',
      outcome: validationFailed ? 'failed' : 'skipped',
      failedSamples: 0,
    };
  }
  const summary = recordOf(report.summary);
  const platform = platformSummary(report);
  const totalSamples = platform.totalSamples || numberValue(
    report.total ?? report.caseCount ?? report.cases,
  );
  const passedSamples = platform.passedSamples || numberValue(report.passed);
  const skipped = report.skipped === true || platform.skipped;
  // 有逐样本统计时，以统计结果为准；顶层 ok:true 不能覆盖失败样本。
  const passed =
    !skipped &&
    platform.checksPassed &&
    (platform.totalSamples > 0
      ? platform.passedSamples === platform.totalSamples
      : passedValue(report));
  return {
    mode: platform.live || report.live === true ? 'live' : definition.mode,
    passed,
    averageScore:
      totalSamples > 0
        ? passedSamples / totalSamples
        : numberValue(report.score ?? report.accuracy ?? report.passRate),
    totalSamples,
    refusalRate: numberValue(report.refusalRate ?? summary.refusalRate),
    citationRate: numberValue(report.citationRate ?? summary.citationRate),
    reason: skipped
      ? stringValue(report.reason) ?? '本次评测已跳过'
      : passed
        ? undefined
        : stringValue(report.reason),
    outcome: skipped ? 'skipped' : passed ? 'passed' : 'failed',
    failedSamples: Math.max(0, totalSamples - passedSamples),
  };
}

function platformSummary(report: Record<string, unknown>): {
  totalSamples: number;
  passedSamples: number;
  skipped: boolean;
  live: boolean;
  checksPassed: boolean;
} {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const liveChecks = checks
    .map(recordOf)
    .filter((check) => recordOf(check.summary).byMode);
  let totalSamples = 0;
  let passedSamples = 0;
  let skipped = liveChecks.length > 0;
  let live = false;
  const checksPassed = checks.every((check) => recordOf(check).ok !== false);
  for (const check of liveChecks) {
    const byMode = recordOf(recordOf(check.summary).byMode);
    const values = Object.values(byMode).map(recordOf);
    totalSamples += values.reduce((sum, value) => sum + numberValue(value.total), 0);
    passedSamples += values.reduce((sum, value) => sum + numberValue(value.passed), 0);
    skipped &&= check.skipped === true;
    live ||= check.live === true;
  }
  return { totalSamples, passedSamples, skipped, live, checksPassed };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function passedValue(report: Record<string, unknown>): boolean {
  if (typeof report.ok === 'boolean') return report.ok;
  if (typeof report.accuracy === 'number') return report.accuracy >= 1;
  if (typeof report.passed === 'number' && typeof report.total === 'number') {
    return report.total > 0 && report.passed === report.total;
  }
  return false;
}
