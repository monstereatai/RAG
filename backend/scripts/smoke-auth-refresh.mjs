/**
 * 双 token（access / refresh）机制冒烟验证
 *
 * 不依赖数据库 / HTTP 服务：直接加载 `pnpm --filter backend run build` 的编译产物
 * （dist），用真实 @nestjs/jwt JwtService + ConfigService 手工构造
 * AuthService / JwtAuthGuard，验证：
 *
 *   1. login 返回双 token，access token 可通过 JwtAuthGuard 访问业务接口
 *   2. refresh token 调业务 Guard 被 401 拒绝
 *   3. 无 type 字段的旧版本 token（存量登录态）仍按 access 放行
 *   4. POST /auth/refresh 语义：轮换出新双 token，且旧 refresh 不可当作 access
 *   5. refresh 校验闭环：access token / 垃圾 token / 不存在用户均被 401 拒绝
 *
 * 运行：pnpm --filter backend exec node scripts/smoke-auth-refresh.mjs（exit 0 = 通过）
 */
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// dist 编译产物使用装饰器元数据，必须最先加载 reflect-metadata
const require = createRequire(import.meta.url);
require('reflect-metadata');

const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { UnauthorizedException } = require('@nestjs/common');
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const { ApiTokenService } = require(
  '../dist/src/modules/auth/api-token.service.js',
);
const { JwtAuthGuard } = require('../dist/src/common/guards/jwt-auth.guard.js');

const JWT_SECRET = 'smoke-jwt-secret';
const JWT_ACCESS_EXPIRES = '2h';
const JWT_REFRESH_EXPIRES = '7d';

/** 构造最小 ExecutionContext stub（结构对齐 jwt-auth.guard.ts 的读取路径） */
function makeExecutionContext(token) {
  const request = {
    headers: { authorization: `Bearer ${token}` },
    query: {},
    user: undefined,
  };
  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    },
  };
}

async function main() {
  // JWT_REFRESH_SECRET 刻意不配置，覆盖"回落 JWT_SECRET + Guard type 校验兜底"路径；
  // API token 存储指向临时目录，避免冒烟写入真实 workspace
  const tmpDir = await mkdtemp(join(tmpdir(), 'smoke-auth-refresh-'));
  process.env.RAG_API_TOKEN_STORE = join(tmpDir, 'api-tokens.json');

  const configService = new ConfigService({
    JWT_SECRET,
    JWT_ACCESS_EXPIRES,
    JWT_REFRESH_EXPIRES,
  });
  const jwtService = new JwtService({ secret: JWT_SECRET });
  const apiTokenService = new ApiTokenService(configService);
  const authService = new AuthService(jwtService, configService);
  const guard = new JwtAuthGuard(authService, apiTokenService);

  const checks = [];
  const record = (name, pass, detail = '') => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // ---- 1. login 返回双 token（保留原有字段，向后兼容） ----
  const login = await authService.login({
    username: 'admin',
    password: 'admin123',
  });
  const decodedAccess = jwtService.decode(login.accessToken, { json: true });
  const decodedRefresh = jwtService.decode(login.refreshToken, { json: true });
  record(
    'login 返回 accessToken/refreshToken/tokenType/expiresIn',
    Boolean(
      login.accessToken &&
        login.refreshToken &&
        login.tokenType === 'Bearer' &&
        login.expiresIn === JWT_ACCESS_EXPIRES &&
        login.refreshTokenExpiresIn === JWT_REFRESH_EXPIRES,
    ),
    `expiresIn=${login.expiresIn}, refreshTokenExpiresIn=${login.refreshTokenExpiresIn}`,
  );
  record(
    'JWT payload 携带 type=access / type=refresh 且保留 userId/username/role',
    decodedAccess.type === 'access' &&
      decodedRefresh.type === 'refresh' &&
      decodedAccess.userId === '1' &&
      decodedAccess.username === 'admin' &&
      decodedAccess.role === 'admin',
    `accessTtl=${decodedAccess.exp - decodedAccess.iat}s, refreshTtl=${decodedRefresh.exp - decodedRefresh.iat}s`,
  );
  record(
    '有效期符合 JWT_ACCESS_EXPIRES=2h / JWT_REFRESH_EXPIRES=7d',
    decodedAccess.exp - decodedAccess.iat === 2 * 3600 &&
      decodedRefresh.exp - decodedRefresh.iat === 7 * 24 * 3600,
  );

  // ---- 2. access token 通过业务 Guard ----
  const accessCtx = makeExecutionContext(login.accessToken);
  const accessPassed = await guard.canActivate(accessCtx.context);
  record(
    'access token 通过 JwtAuthGuard（业务接口放行）',
    accessPassed === true &&
      accessCtx.request.user?.userId === '1' &&
      accessCtx.request.user?.type === 'access',
  );

  // ---- 3. refresh token 调业务 Guard 被拒（401） ----
  const refreshRejected = await guard
    .canActivate(makeExecutionContext(login.refreshToken).context)
    .then(() => null)
    .catch((error) => error);
  record(
    'refresh token 被 JwtAuthGuard 以 401 拒绝',
    refreshRejected instanceof UnauthorizedException &&
      refreshRejected.getStatus() === 401,
    refreshRejected?.message,
  );

  // ---- 4. 无 type 字段的旧 token（存量登录态）仍放行 ----
  const legacyToken = await jwtService.signAsync({
    userId: '2',
    username: 'user',
    role: 'user',
  });
  const legacyCtx = makeExecutionContext(legacyToken);
  const legacyPassed = await guard.canActivate(legacyCtx.context);
  record(
    '无 type 字段的旧 token 视为 access 放行（兼容存量登录态）',
    legacyPassed === true &&
      legacyCtx.request.user?.username === 'user' &&
      legacyCtx.request.user?.type === undefined,
  );

  // ---- 5. /auth/refresh：轮换出新双 token，且新 token 各司其职 ----
  // JWT 是确定性签名：同 payload + 同密钥 + 同一秒内签发会得到完全相同的 token，
  // 这里等跨秒后再轮换，确保"新旧 token 不同"的断言有效（真实场景刷新本身跨分钟/天）
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const refreshed = await authService.refresh(login.refreshToken);
  const refreshedAccessCtx = makeExecutionContext(refreshed.accessToken);
  const refreshedAccessPassed = await guard.canActivate(refreshedAccessCtx.context);
  const refreshedRefreshRejected = await guard
    .canActivate(makeExecutionContext(refreshed.refreshToken).context)
    .then(() => null)
    .catch((error) => error);
  record(
    'refresh 轮换出新双 token（新旧 token 不同）',
    Boolean(
      refreshed.accessToken &&
        refreshed.refreshToken &&
        refreshed.accessToken !== login.accessToken &&
        refreshed.refreshToken !== login.refreshToken,
    ),
  );
  record(
    '轮换后的 access 放行、refresh 仍被业务 Guard 拒绝',
    refreshedAccessPassed === true &&
      refreshedRefreshRejected instanceof UnauthorizedException,
  );

  // ---- 6. refresh 校验闭环负例 ----
  const refreshWithAccess = await authService
    .refresh(login.accessToken)
    .then(() => null)
    .catch((error) => error);
  const refreshWithGarbage = await authService
    .refresh('not-a-jwt')
    .then(() => null)
    .catch((error) => error);
  const ghostRefreshToken = await jwtService.signAsync(
    { userId: '404', username: 'ghost', role: 'user', type: 'refresh' },
    { secret: JWT_SECRET },
  );
  const refreshWithGhostUser = await authService
    .refresh(ghostRefreshToken)
    .then(() => null)
    .catch((error) => error);
  record(
    '用 access token / 垃圾串 / 不存在用户调用 refresh 均被 401 拒绝',
    [refreshWithAccess, refreshWithGarbage, refreshWithGhostUser].every(
      (error) => error instanceof UnauthorizedException,
    ),
    [refreshWithAccess, refreshWithGarbage, refreshWithGhostUser]
      .map((error) => error.message)
      .join(' | '),
  );

  const ok = checks.every((check) => check.pass);
  console.log(
    JSON.stringify(
      { ok, total: checks.length, failed: checks.filter((c) => !c.pass).length },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('smoke-auth-refresh crashed:', error);
  process.exitCode = 1;
});
