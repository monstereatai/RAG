// 指标去 JSON 包裹代理（仅本地查看 Prometheus 指标时使用）
//
// 背景：后端全局 TransformInterceptor 会把 /api/v1/metrics 的响应包成
// { code, data, message }，而 Prometheus 只认裸文本，抓取会直接失败。
// 本代理取回 JSON 后剥掉外层，只吐出 data 字段，供 Prometheus 抓取。
//
// 用法：
//   PORT=9101 UPSTREAM=http://localhost:3000/api/v1/metrics \
//     node scripts/metrics-unwrap-proxy.mjs
//
// 注意：这只是在后端重启前让 Prometheus 能捞到数据的临时桥；
// 正解是给 metrics 路由豁免统一响应拦截器。

import http from 'node:http';

const port = Number(process.env.PORT ?? 9101);
const upstream =
  process.env.UPSTREAM ?? 'http://localhost:3000/api/v1/metrics';

http
  .createServer(async (req, res) => {
    try {
      const response = await fetch(upstream, {
        signal: AbortSignal.timeout(5_000),
      });
      const text = await response.text();
      let body = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && typeof parsed.data === 'string')
          body = parsed.data;
      } catch {
        // 上游已是裸文本，直接透传
      }
      res.writeHead(response.ok ? 200 : 502, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(body);
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`# scrape upstream failed: ${error.message}\n`);
    }
  })
  .listen(port, () => {
    console.log(`metrics unwrap proxy: http://localhost:${port}/ -> ${upstream}`);
  });
