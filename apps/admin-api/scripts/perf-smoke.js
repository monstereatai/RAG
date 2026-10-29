const http = require('http');
const https = require('https');

const targetUrl = process.env.PERF_TARGET || 'http://127.0.0.1:3001/health';
const totalRequests = Number(process.env.PERF_REQUESTS || 100);
const concurrency = Number(process.env.PERF_CONCURRENCY || 10);

const client = targetUrl.startsWith('https:') ? https : http;
const latencies = [];
let completed = 0;
let failed = 0;
let nextRequest = 0;
const startedAt = Date.now();

function requestOnce() {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = client.get(targetUrl, (res) => {
      res.resume();
      res.on('end', () => {
        const latency = Date.now() - started;
        latencies.push(latency);
        if (res.statusCode < 200 || res.statusCode >= 400) {
          failed += 1;
        }
        resolve();
      });
    });

    req.on('error', () => {
      failed += 1;
      resolve();
    });

    req.setTimeout(5000, () => {
      req.destroy();
      failed += 1;
      resolve();
    });
  });
}

async function worker() {
  while (nextRequest < totalRequests) {
    nextRequest += 1;
    await requestOnce();
    completed += 1;
  }
}

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function main() {
  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker()),
  );

  const durationSeconds = (Date.now() - startedAt) / 1000;
  const qps = completed / durationSeconds;
  const report = {
    target: targetUrl,
    totalRequests,
    concurrency,
    completed,
    failed,
    qps: Number(qps.toFixed(2)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
  };

  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
