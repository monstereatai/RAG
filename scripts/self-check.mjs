#!/usr/bin/env node
/**
 * 本地三段服务统一自检脚本
 *
 * 串联检查 rag-backend:3000、admin-backend:3001、admin:8000
 * 以及管理员登录、RAG health、Admin health、AG-UI 连续两次流式请求。
 *
 * 用法:
 *   node scripts/self-check.mjs
 *   RAG_URL=http://localhost:3000 ADMIN_BACKEND_URL=http://localhost:3001 ADMIN_FRONTEND_URL=http://localhost:8000 node scripts/self-check.mjs
 */

const RAG_URL = process.env.RAG_URL || 'http://localhost:3000';
const ADMIN_BACKEND_URL = process.env.ADMIN_BACKEND_URL || 'http://localhost:3001';
const ADMIN_FRONTEND_URL = process.env.ADMIN_FRONTEND_URL || 'http://localhost:8000';

const PASSED = '✅';
const FAILED = '❌';
const SKIPPED = '⏭️';

let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;

function pass(label) {
  passedCount++;
  console.log(`  ${PASSED} ${label}`);
}

function fail(label, err) {
  failedCount++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ${FAILED} ${label}: ${msg.slice(0, 200)}`);
}

function skip(label) {
  skippedCount++;
  console.log(`  ${SKIPPED} ${label}`);
}

async function checkHealth(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.status === 'ok' || body?.data?.status === 'ok' || res.ok) {
      pass(label);
    } else {
      fail(label, `unexpected response: ${JSON.stringify(body).slice(0, 100)}`);
    }
  } catch (err) {
    fail(label, err);
  }
}

async function checkLogin(url, label) {
  try {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const token = body?.data?.accessToken;
    if (token) {
      pass(label);
      return token;
    }
    fail(label, `no accessToken in response`);
    return null;
  } catch (err) {
    fail(label, err);
    return null;
  }
}

async function checkAguiStream(url, query, mode, label) {
  try {
    const res = await fetch(
      `${url}/api/v1/agui/stream?query=${encodeURIComponent(query)}&mode=${mode}`,
      {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body reader');

    const decoder = new TextDecoder();
    let fullText = '';
    let gotRunFinished = false;
    let gotRunError = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;

      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'RUN_FINISHED') gotRunFinished = true;
            if (evt.type === 'RUN_ERROR') gotRunError = true;
          } catch { /* skip parse errors */ }
        }
      }
    }

    if (gotRunError) {
      fail(label, `RUN_ERROR received. events:\n${fullText.slice(0, 300)}`);
    } else if (gotRunFinished || fullText.includes('RUN_FINISHED')) {
      pass(label);
    } else {
      fail(label, `no RUN_FINISHED. raw (first 300): ${fullText.slice(0, 300)}`);
    }
  } catch (err) {
    fail(label, err);
  }
}

async function main() {
  console.log(`\n🔍 本地三段服务自检\n`);
  console.log(`RAG backend:       ${RAG_URL}`);
  console.log(`Admin backend:     ${ADMIN_BACKEND_URL}`);
  console.log(`Admin frontend:    ${ADMIN_FRONTEND_URL}`);
  console.log('');

  // 1. rag-backend health
  console.log(`\n[1/5] rag-backend 健康检查`);
  await checkHealth(`${RAG_URL}/api/v1/health`, `RAG health endpoint`);

  // 2. admin-backend health
  console.log(`\n[2/5] admin-backend 健康检查`);
  await checkHealth(`${ADMIN_BACKEND_URL}/health`, `Admin health endpoint`);

  // 3. admin frontend
  console.log(`\n[3/5] 管理后台前端`);
  try {
    const res = await fetch(ADMIN_FRONTEND_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      pass(`Frontend responds HTTP ${res.status}`);
    } else {
      fail(`Frontend`, `HTTP ${res.status}`);
    }
  } catch (err) {
    fail(`Frontend`, err);
  }

  // 4. 管理员登录
  console.log(`\n[4/5] 管理员登录`);
  const token = await checkLogin(ADMIN_BACKEND_URL, `Login as admin`);
  if (token) {
    // Verify token with profile
    try {
      const res = await fetch(`${ADMIN_BACKEND_URL}/api/admin/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = await res.json();
        const profile = body?.data ?? body;
        if (profile?.userId || profile?.username) {
          pass(`Profile check (user=${profile.username || profile.userId})`);
        } else {
          fail(`Profile check`, `unexpected: ${JSON.stringify(body).slice(0, 100)}`);
        }
      } else {
        fail(`Profile check`, `HTTP ${res.status}`);
      }
    } catch (err) {
      fail(`Profile check`, err);
    }
  } else {
    skip('Skipping profile check (no token)');
  }

  // 5. AG-UI 连续两次流式请求
  console.log(`\n[5/5] AG-UI 流式问答`);
  await checkAguiStream(RAG_URL, '今天是星期几', 'simple', 'simple: "今天是星期几"');
  await checkAguiStream(RAG_URL, '什么是 RAG', 'auto', 'auto: "什么是 RAG"');

  // Summary
  console.log(`\n═══════════════════════════════`);
  console.log(`结果汇总`);
  console.log(`  通过: ${passedCount}`);
  console.log(`  失败: ${failedCount}`);
  console.log(`  跳过: ${skippedCount}`);
  console.log(`═══════════════════════════════\n`);

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
