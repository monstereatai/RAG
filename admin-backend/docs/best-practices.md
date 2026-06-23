# Best Practices

本文档记录 admin-backend 项目中已落地的工程规范，不是愿景，是现实。

---

## 1. DTO 校验模式

所有 Controller 入参必须通过 DTO（class-validator + class-transformer）。全局 `ValidationPipe` 配置了三个选项：

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,          // 剔除 DTO 中未声明的字段
  transform: true,          // 自动类型转换（string → number 等）
  forbidNonWhitelisted: true, // 遇到未声明字段直接 400，不静默忽略
}));
```

**规则**：
- 每个写接口（POST/PUT/PATCH）必须有独立的 `CreateXxxDto` / `UpdateXxxDto`
- DTO 字段用 `@ApiProperty()` 标注，确保 Swagger 文档有完整 schema
- `@IsOptional()` 字段必须配合 `@IsXxx()` 使用，不能只写一个

**错误示例**（禁止）：
```typescript
// ❌ any 类型接收所有输入，绕过 ValidationPipe
create(@Body() createDto: any) { ... }
```

---

## 2. JWT 配置规范

### 环境变量

| 变量名 | 说明 | 示例 |
|---|---|---|
| `JWT_SECRET` | JWT 签名密钥，**必须** ≥32 字符 | `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | token 过期时间 | `1h` / `7d` |

### 配置方式

`AuthModule` 使用 `JwtModule.registerAsync` 从 `ConfigService` 读取，不允许 `JwtModule.register({ secret: 'hardcoded' })`。

### Token Payload

```typescript
{
  sub: userId,         // 用户 ID
  username: string,    // 用户名
  role: string,        // 基础角色标识
  permissions: string[] // 权限码列表，供 PermissionGuard 使用
}
```

`refresh_token` 必须携带 `sub` 和 `username`，刷新时重新读取用户与权限，再签发新的 `access_token`。

### 保护路由

- 全局保护：`LoginGuard` 作为全局 Guard 注册
- 公开路由：使用 `@RequireLogin(false)`
- 权限限制：使用 `@RequirePermission('scope:resource:action')`
- 权限来源：登录签发 token 时从用户角色展开权限码，`PermissionGuard` 只校验 token 中的权限快照

---

## 3. 环境变量管理

### 文件约定

| 文件 | 用途 | 进 Git |
|---|---|---|
| `.env.example` | 所有变量的说明模板，值为示例或空 | ✅ 是 |
| `.env.development` | 本地开发值 | ❌ 否（`.gitignore`） |
| `.env.production` | 生产值 | ❌ 否（平台注入） |
| `.env` | 通用兜底 | ❌ 否 |

### 规则

- 密钥、密码、token 永远不进代码，不进 commit，不进日志
- 本地开发使用 `.env.development`，CI/CD 通过平台 secrets 注入
- 新增环境变量必须同步更新 `.env.example`（含说明注释）
- 运行时按 `NODE_ENV` 读取 `.env.${NODE_ENV}` 和 `.env`；`production` 不应依赖开发环境文件

---

## 4. 数据库操作规范

### 开发环境
```bash
ENABLE_DATABASE=true DB_SYNCHRONIZE=true npm start
```
`DB_SYNCHRONIZE=true` 自动同步 schema，仅用于本地开发迭代。

### 生产环境（强制）
```bash
DB_SYNCHRONIZE=false  # 禁止自动同步
npm run migration:generate  # 生成迁移文件后人工 review
npm run migration:run       # 确认后执行
```

**绝不允许**在生产服务器上用 `DB_SYNCHRONIZE=true` 启动。

### 迁移门禁

```bash
npm run migration:check
```

该命令会检查：

- `data-source.ts` 必须保持 `synchronize: false`
- `src/database/migrations/` 必须存在 baseline migration
- `package.json` 必须保留 generate / run / run:prod / revert 迁移脚本

生产容器只运行编译后的迁移入口：

```bash
npm run migration:run:prod
```

---

## 5. 安全防护检查清单

部署前逐项确认：

- [ ] `JWT_SECRET` ≥32 字符随机字符串（非默认值）
- [ ] `DB_PASSWORD` 非 `123456` / `password` 等弱密码
- [ ] `ALLOWED_ORIGINS` 只包含实际前端域名
- [ ] HTTPS 已启用（Nginx/LB 层 TLS 终止）
- [ ] `DB_SYNCHRONIZE=false`
- [ ] `NODE_ENV=production`
- [ ] 日志不输出任何用户密码或 token 明文
- [ ] `npm run verify:ci` 通过
- [ ] `INTEGRATION_TESTS=true npm run verify:integration` 在 Docker 基础设施上通过
- [ ] `npm run audit:high` 已清零或有正式风险接受记录
