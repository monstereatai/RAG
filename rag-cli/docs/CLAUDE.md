# CLAUDE.md — RAG CLI docs 目录规则

> 本目录是 `rag-cli` 项目内的产品、架构和规划文档目录，不属于 RAG 服务项目的产品文档体系。

## 项目定位

本目录只维护 RAG CLI 的产品需求、架构设计、命令规划和后续实现约束。CLI 代码实现放在 `rag-cli/src/`，真实实现进度以 `rag-cli/ROADMAP.md` 为准。

CLI 可以调用 RAG 服务 API，但 CLI 项目与 RAG 服务项目是两个不同项目：

- RAG 服务项目负责知识库、检索、问答、索引、评测和后台 API。
- CLI 项目负责命令行入口、鉴权配置、API 调用封装、输出协议和上下文包生成。

## 文档关系

- `CLI_PRD.md`：CLI 功能列表与产品需求。
- `CLI_ARCHITECTURE.md`：CLI 架构设计、框架选型和实施边界。
- `CLI_ROADMAP.md`：CLI 文档项目真实进度源。
- `CLAUDE.md`：本目录规则。

## 目录规则

- CLI 相关产品和架构文档放在本目录，不放到 RAG 根级文档关系中。
- CLI 实现代码放在 `rag-cli/src/`，测试放在 `rag-cli/test/`。
- 本目录不记录 RAG 服务项目进度；RAG 服务进度仍由根级 `ROADMAP.md` 维护。

## 红线

- 不在本目录写真实 token、密码、密钥。
- 不把 CLI 发布、部署、CI/CD 改动写成已确认事项。
- 不把未实现的 CLI 功能标成已完成。
- 不修改 RAG 服务 schema、迁移或生产配置。
