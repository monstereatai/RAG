# CLAUDE.md — RAG CLI 项目规则

> 本目录是独立的 RAG CLI 实现项目，不属于 RAG 服务项目代码。

## 项目定位

RAG CLI 是一个命令行知识库网关：

- 人类可以直接查询 RAG 知识库、问答和诊断服务状态。
- 脚本、Codex/Claude Code、Skill 可以用稳定 JSON 输出获取上下文包。
- CLI 只通过 RAG 后端 API 工作，不直接访问数据库、向量库、Redis、Neo4j 或 `.env`。

## 文档关系

- `ROADMAP.md`：本 CLI 项目的真实进度源。
- `docs/CLI_PRD.md`：CLI 产品需求。
- `docs/CLI_ARCHITECTURE.md`：CLI 架构设计与选型。
- `docs/CLI_ROADMAP.md`：CLI 文档规划与历史决策记录。
- `USAGE.zh-CN.md`：中文使用说明。
- `CLAUDE.md`：本目录规则。

## 技术栈

- TypeScript + Node.js 20+
- Commander.js：命令框架
- Zod：输入/输出 schema 校验
- Node readline：交互式登录/初始化
- Chalk：人类输出美化
- 自定义 stderr spinner：human 模式 loading
- Node fetch：HTTP API 调用

## 目录约定

```text
rag-cli/
├── docs/
├── src/
│   ├── bin.ts
│   ├── commands/
│   ├── core/
│   └── context/
└── test/
```

- `commands/` 只做参数解析和命令编排。
- `core/api-client.ts` 统一处理 HTTP、鉴权、超时和错误。
- `core/config-store.ts` 只写用户目录配置，不写项目 `.env`。
- `core/output.ts` 保证 JSON 输出稳定。
- `context/` 只负责上下文包生成，不直接改代码。

## 验证命令

```bash
pnpm run build
pnpm test
node dist/src/bin.js --help
node dist/src/bin.js doctor --format json
```

## 红线

- 不保存密码。
- 不输出 token 原文。
- 不写 RAG 服务 `.env`。
- 不改 RAG 服务 schema、migration、CI/CD、生产配置。
- 不做 npm publish。
- 不自动改代码、commit、push 或部署。
