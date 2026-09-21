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
      const summary =
        report.summary && typeof report.summary === 'object'
          ? (report.summary as Record<string, unknown>)
          : {};
      return {
        datasetName: definition.datasetName,
        mode: report.live === true ? 'live' : definition.mode,
        passed: passedValue(report),
        averageScore: numberValue(
          report.score ?? report.accuracy ?? report.passRate,
        ),
        totalSamples: numberValue(
          report.total ?? report.caseCount ?? report.cases,
        ),
        refusalRate: numberValue(report.refusalRate ?? summary.refusalRate),
        citationRate: numberValue(report.citationRate ?? summary.citationRate),
        available: true,
        lastRunAt: stringValue(report.generatedAt),
        source: 'report-file',
        reason: passedValue(report) ? undefined : stringValue(report.reason),
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
  };
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
