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
});
