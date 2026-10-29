/**
 * 邮箱激活 + 验证码重置密码 + 邮件模块 离线冒烟验证
 *
 * 不依赖数据库 / Redis / HTTP 服务：直接加载 `pnpm --filter backend run build`
 * 的编译产物（dist），真实调用编译后的 service 方法（手工构造依赖）：
 *
 *   - TokenStore：不注入 RedisProvider → 自动降级为进程内存实现（降级注入点）
 *   - MailService：不配置 MAIL_* → 本地模拟模式，读 workspace/mail-outbox
 *     的临时替代目录 latest.json 断言邮件内容
 *   - AuthUserStore：RAG_AUTH_USERS_STORE 指向临时文件（重启落盘不丢的注入点）
 *
 * 覆盖闭环：
 *   A. 种子用户回归：admin/admin123 可登录（向后兼容）
 *   B. 注册 → 未激活登录 403 → 从模拟邮件提取 token → 激活 → 登录拿双 token → refresh 轮换
 *   C. 发码 → 错码被拒 → 正确码重置 → 新密码登录成功 → 验证码一次性消费
 *   D. 防枚举：不存在邮箱的发码响应与成功一致
 *
 * 运行：pnpm --filter backend exec node scripts/smoke-mail-auth.mjs（exit 0 = 通过）
 */
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// dist 编译产物使用装饰器元数据，必须最先加载 reflect-metadata
const require = createRequire(import.meta.url);
require('reflect-metadata');

const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} = require('@nestjs/common');
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const { AuthUserStore } = require('../dist/src/modules/auth/auth-user.store.js');
const { TokenStoreService } = require(
  '../dist/src/modules/auth/token-store/token-store.service.js',
);
const { MailService } = require('../dist/src/modules/mail/mail.service.js');

const JWT_SECRET = 'smoke-jwt-secret';

/** 模拟邮件 latest.json 读取 */
async function readLatestMail(outboxDir) {
  return JSON.parse(
    await readFile(join(outboxDir, 'latest.json'), 'utf8'),
  );
}

async function main() {
  // 用户存储与模拟邮件目录均指向临时路径，避免冒烟写入真实 workspace
  const tmpDir = await mkdtemp(join(tmpdir(), 'smoke-mail-auth-'));
  const usersFile = join(tmpDir, 'auth-users.json');
  const outboxDir = join(tmpDir, 'mail-outbox');
  process.env.RAG_AUTH_USERS_STORE = usersFile;
  process.env.RAG_MAIL_OUTBOX_DIR = outboxDir;

  const configService = new ConfigService({
    JWT_SECRET,
    JWT_ACCESS_EXPIRES: '2h',
    JWT_REFRESH_EXPIRES: '7d',
    // 刻意不配置 MAIL_*：MailService 进入本地模拟模式
  });
  const jwtService = new JwtService({ secret: JWT_SECRET });

  // 冒烟注入点：TokenStoreService 不注入 RedisProvider → 纯进程内存实现
  const tokenStore = new TokenStoreService(undefined);
  const mailService = new MailService(configService);
  const userStore = new AuthUserStore(configService);
  const authService = new AuthService(
    jwtService,
    configService,
    userStore,
    tokenStore,
    mailService,
  );

  if (mailService.smtpConfigured) {
    throw new Error('smoke 环境不应配置 MAIL_*，否则会真实发邮件');
  }

  const checks = [];
  const record = (name, pass, detail = '') => {
    checks.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const errorOf = (promise) =>
    promise.then(
      () => null,
      (error) => error,
    );

  // ---- A. 种子用户回归（原硬编码测试账号保留为种子） ----
  const seedLogin = await authService.login({ username: 'admin', password: 'admin123' });
  const seedPayload = jwtService.decode(seedLogin.accessToken, { json: true });
  record(
    '种子用户 admin/admin123 仍可登录（向后兼容）',
    seedPayload.username === 'admin' &&
      seedPayload.userId === '1' &&
      seedPayload.role === 'admin' &&
      seedPayload.type === 'access',
  );

  // ---- B1. 注册：落盘 emailVerified=false，模拟邮件携带激活链接 ----
  const registered = await authService.register({
    username: 'demo',
    password: 'demo123456',
    email: 'Demo@Example.com',
    realName: '演示用户',
  });
  const storedUser = await userStore.findByEmail('demo@example.com');
  const activationMail = await readLatestMail(outboxDir);
  const activationToken =
    /token=([A-Za-z0-9_-]+)/.exec(activationMail.html ?? '')?.[1] ?? '';
  record(
    '注册成功且 emailVerified=false（邮箱大小写归一化）',
    Boolean(registered.userId) &&
      registered.emailVerified === false &&
      registered.email === 'demo@example.com' &&
      storedUser?.emailVerified === false,
  );
  record(
    '激活邮件进入模拟模式并写入 latest.json（含一次性 token 链接）',
    activationMail.mode === 'simulated' &&
      activationMail.to === 'demo@example.com' &&
      typeof activationMail.sentAt === 'string' &&
      activationMail.html.includes('/api/v1/auth/verify-email?token=') &&
      activationToken.length > 20,
    `sentAt=${activationMail.sentAt}`,
  );

  // ---- B2. 查重：重复用户名 / 重复邮箱均 409 ----
  const dupUsername = await errorOf(
    authService.register({
      username: 'demo',
      password: 'demo123456',
      email: 'other@example.com',
    }),
  );
  const dupEmail = await errorOf(
    authService.register({
      username: 'another',
      password: 'demo123456',
      email: 'demo@example.com',
    }),
  );
  record(
    '重复用户名 / 重复邮箱注册被 409 拒绝',
    dupUsername instanceof ConflictException &&
      dupEmail instanceof ConflictException,
    `${dupUsername?.message} | ${dupEmail?.message}`,
  );

  // ---- B3. 未激活登录 403；错误口令 401 ----
  const unverifiedLogin = await errorOf(
    authService.login({ username: 'demo', password: 'demo123456' }),
  );
  const wrongPassword = await errorOf(
    authService.login({ username: 'demo', password: 'wrong-password' }),
  );
  record(
    '未激活登录被 403 拒绝（AUTH_REQUIRE_EMAIL_VERIFIED 默认 true）',
    unverifiedLogin instanceof ForbiddenException &&
      unverifiedLogin.getStatus() === 403,
    unverifiedLogin?.message,
  );
  record(
    '错误口令被 401 拒绝（先验口令，不泄露激活状态）',
    wrongPassword instanceof UnauthorizedException,
  );

  // ---- B4. 激活闭环：提取 token → 激活 → token 一次性消费 ----
  const verified = await authService.verifyEmail(activationToken);
  const replayed = await errorOf(authService.verifyEmail(activationToken));
  record(
    '激活成功置 emailVerified=true，token 重放被 400 拒绝（一次性消费）',
    verified.verified === true &&
      verified.alreadyVerified === false &&
      verified.username === 'demo' &&
      replayed instanceof BadRequestException,
    `username=${verified.username}`,
  );

  // ---- B5. 激活后登录拿双 token，refresh 轮换 ----
  const login = await authService.login({
    username: 'demo',
    password: 'demo123456',
  });
  const loginAccess = jwtService.decode(login.accessToken, { json: true });
  const loginRefresh = jwtService.decode(login.refreshToken, { json: true });
  record(
    '激活后登录成功并签发双 token（userId 一致）',
    Boolean(login.accessToken && login.refreshToken) &&
      loginAccess.type === 'access' &&
      loginRefresh.type === 'refresh' &&
      loginAccess.userId === registered.userId,
  );

  // JWT 确定性签名：等跨秒后轮换，确保新旧 token 不同
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const refreshed = await authService.refresh(login.refreshToken);
  const refreshedAccess = jwtService.decode(refreshed.accessToken, { json: true });
  record(
    'refresh 轮换出新双 token（userId 保留）',
    Boolean(
      refreshed.accessToken &&
        refreshed.refreshToken &&
        refreshed.accessToken !== login.accessToken &&
        refreshedAccess.userId === registered.userId,
    ),
  );

  // ---- C. 验证码重置密码闭环 ----
  const resetCodeResponse = await authService.sendPasswordResetCode({
    email: 'demo@example.com',
  });
  const resetMail = await readLatestMail(outboxDir);
  const resetCode = /\b(\d{6})\b/.exec(resetMail.html ?? '')?.[1] ?? '';
  record(
    '发码成功，验证码邮件覆盖写入 latest.json（6 位数字）',
    resetCodeResponse.sent === true &&
      resetMail.subject.includes('密码重置') &&
      /^\d{6}$/.test(resetCode),
    `code=${resetCode}`,
  );

  const wrongCode = resetCode === '000000' ? '111111' : '000000';
  const wrongCodeReset = await errorOf(
    authService.resetPassword({
      email: 'demo@example.com',
      code: wrongCode,
      newPassword: 'newpass123',
    }),
  );
  record(
    '错误验证码重置被 400 拒绝',
    wrongCodeReset instanceof BadRequestException,
    wrongCodeReset?.message,
  );

  const reset = await authService.resetPassword({
    email: 'demo@example.com',
    code: resetCode,
    newPassword: 'newpass123',
  });
  record(
    '正确验证码重置成功',
    reset.reset === true,
  );

  const codeReuse = await errorOf(
    authService.resetPassword({
      email: 'demo@example.com',
      code: resetCode,
      newPassword: 'another123',
    }),
  );
  record(
    '验证码重置后即被删除（二次使用 400）',
    codeReuse instanceof BadRequestException,
  );

  const oldPasswordLogin = await errorOf(
    authService.login({ username: 'demo', password: 'demo123456' }),
  );
  const newPasswordLogin = await authService.login({
    username: 'demo',
    password: 'newpass123',
  });
  record(
    '旧密码 401、新密码登录成功',
    oldPasswordLogin instanceof UnauthorizedException &&
      Boolean(newPasswordLogin.accessToken),
  );

  // ---- D. 防枚举：不存在邮箱的发码响应与成功一致 ----
  const unknownEmailResponse = await authService.sendPasswordResetCode({
    email: 'ghost@example.com',
  });
  record(
    '不存在邮箱的发码响应与成功一致（防账号枚举）',
    unknownEmailResponse.sent === true &&
      unknownEmailResponse.message === resetCodeResponse.message,
  );

  // ---- E. 落盘持久化：新实例指向同一文件仍能读到（重启不丢） ----
  const reopenedStore = new AuthUserStore(configService);
  const persistedUser = await reopenedStore.findByUsername('demo');
  record(
    '注册用户落盘持久化（新实例可读，emailVerified=true 已同步）',
    Boolean(persistedUser) &&
      persistedUser.emailVerified === true &&
      persistedUser.realName === '演示用户',
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
  console.error('smoke-mail-auth crashed:', error);
  process.exitCode = 1;
});
