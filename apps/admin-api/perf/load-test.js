/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// 自定义指标
const loginTrend = new Trend('login_duration');
const userFetchTrend = new Trend('user_fetch_duration');
const errorRate = new Rate('errors');

export const options = {
  // 模拟并发用户阶段：
  // 1. 10秒内上升到 50 个虚拟用户
  // 2. 持续 30 秒保持 50 个虚拟用户
  // 3. 10秒内下降到 0 个虚拟用户
  stages: [
    { duration: '10s', target: 50 },
    { duration: '30s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // 错误率必须低于 1%
    errors: ['rate<0.01'],
    // 95% 的请求延迟必须低于 200ms
    http_req_duration: ['p(95)<200'],
    login_duration: ['p(95)<300'],
    user_fetch_duration: ['p(95)<100'],
  },
};

// 确保你已经有了目标服务器地址，或者使用本地启动的地址
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// 模拟每个用户执行一系列操作
export default function () {
  // 1. 健康检查
  let healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health check returned 200': (r) => r.status === 200 }) || errorRate.add(1);
  
  // 2. 模拟登录请求 (替换成真实可用的默认压测账号)
  const loginPayload = JSON.stringify({
    username: 'test_user_' + Math.floor(Math.random() * 100000),
    password: 'Password123!',
  });
  const headers = { 'Content-Type': 'application/json' };

  // 注意：在实际压测中，如果不想每次注册，请提前造好数据并在这里使用固定的并发账号池。
  // 这里作为通用演示，仅请求并不校验 200，因为账号可能不存在
  let loginRes = http.post(`${BASE_URL}/auth/login`, loginPayload, { headers });
  loginTrend.add(loginRes.timings.duration);

  // 3. 带 Token 请求需要鉴权的接口 (假设我们在环境变量里注入了压测专属的 TOKEN)
  const testToken = __ENV.TEST_TOKEN || 'fake-jwt-token-for-test';
  let usersRes = http.get(`${BASE_URL}/users`, {
    headers: {
      Authorization: `Bearer ${testToken}`,
    },
  });
  userFetchTrend.add(usersRes.timings.duration);

  // 模拟用户的思考时间
  sleep(1);
}
