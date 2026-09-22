import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readEvaluationReportSummaries } from './evaluation-report.store';

describe('evaluation report summaries', () => {
  const previousDirectory = process.env.EVAL_REPORT_DIR;
  let directory = '';

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'rag-evaluation-report-'));
    process.env.EVAL_REPORT_DIR = directory;
  });

  afterEach(() => {
    if (previousDirectory === undefined) delete process.env.EVAL_REPORT_DIR;
    else process.env.EVAL_REPORT_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads the QueryIntentRouter contract result instead of returning a hardcoded pass', () => {
    writeFileSync(
      path.join(directory, 'query-routing-latest.json'),
      JSON.stringify({
        generatedAt: '2026-09-21T00:00:00.000Z',
        total: 12,
        passed: 12,
        accuracy: 1,
      }),
    );

    const reports = readEvaluationReportSummaries();
    const routing = reports.find(
      (report) => report.datasetName === 'query-routing',
    );
    const missing = reports.find(
      (report) => report.datasetName === 'agent-platform',
    );

    expect(routing).toMatchObject({
      available: true,
      passed: true,
      totalSamples: 12,
      averageScore: 1,
    });
    expect(missing).toMatchObject({
      available: false,
      passed: false,
      reason: '尚未生成评测报告',
    });
  });

  it('aggregates live platform samples from per-mode checks and keeps skipped runs visible', () => {
    writeFileSync(
      path.join(directory, 'agent-platform-latest.json'),
      JSON.stringify({
        generatedAt: '2026-09-22T00:00:00.000Z',
        ok: true,
        checks: [
          {
            name: 'project-three-mode-e2e',
            live: true,
            skipped: false,
            summary: {
              byMode: {
                simple: { total: 2, passed: 2 },
                auto: { total: 2, passed: 1 },
                agentic: { total: 2, passed: 2 },
              },
            },
          },
        ],
      }),
    );
    writeFileSync(
      path.join(directory, 'bad-case-regression.json'),
      JSON.stringify({ total: 0, passed: 0, skipped: true }),
    );

    const reports = readEvaluationReportSummaries();

    expect(reports.find((report) => report.datasetName === 'agent-platform')).toMatchObject({
      mode: 'live',
      totalSamples: 6,
      failedSamples: 1,
      averageScore: 5 / 6,
      passed: false,
      outcome: 'failed',
    });
    expect(reports.find((report) => report.datasetName === 'bad-case-regression')).toMatchObject({
      totalSamples: 0,
      passed: false,
      outcome: 'skipped',
      reason: '本次评测已跳过',
    });
  });

  it('does not treat offline golden-business structure validation as QA pass', () => {
    writeFileSync(
      path.join(directory, 'golden-business-latest.json'),
      JSON.stringify({
        generatedAt: '2026-09-22T00:00:00.000Z',
        ok: true,
        live: false,
        caseCount: 86,
        documentCount: 37,
      }),
    );

    const golden = readEvaluationReportSummaries().find(
      (report) => report.datasetName === 'golden-business',
    );

    expect(golden).toMatchObject({
      passed: false,
      outcome: 'skipped',
      totalSamples: 86,
      failedSamples: 0,
      reason: '仅完成数据集结构校验，未执行真实问答',
    });
  });

  it('keeps a failed contract check from being hidden by passing live samples', () => {
    writeFileSync(
      path.join(directory, 'agent-platform-latest.json'),
      JSON.stringify({
        generatedAt: '2026-09-22T00:00:00.000Z',
        ok: false,
        checks: [
          { name: 'contract', ok: false },
          {
            name: 'live',
            ok: true,
            live: true,
            summary: { byMode: { simple: { total: 1, passed: 1 } } },
          },
        ],
      }),
    );

    expect(readEvaluationReportSummaries().find(
      (report) => report.datasetName === 'agent-platform',
    )).toMatchObject({
      passed: false,
      outcome: 'failed',
      totalSamples: 1,
      failedSamples: 0,
    });
  });

  it('distinguishes failed offline dataset validation from skipped live execution', () => {
    writeFileSync(
      path.join(directory, 'golden-business-latest.json'),
      JSON.stringify({
        generatedAt: '2026-09-22T00:00:00.000Z',
        ok: false,
        live: false,
        caseCount: 3,
        reason: '缺少 sourceDocument',
      }),
    );

    expect(readEvaluationReportSummaries().find(
      (report) => report.datasetName === 'golden-business',
    )).toMatchObject({
      passed: false,
      outcome: 'failed',
      reason: '缺少 sourceDocument',
    });
  });
});
