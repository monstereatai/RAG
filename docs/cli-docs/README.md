# RAG CLI 与主项目的关系

RAG CLI 位于 `packages/rag-cli/`，是调用 RAG 服务 API 的独立命令行客户端。主项目文档只记录它在整体系统中的职责与边界；产品需求、实现架构、使用说明和实现进度以 CLI 包内文档为准。

## 职责

- 为人、脚本和编码智能体提供知识检索、问答、上下文整理及相关后端 API 的命令行入口。
- 统一 API 鉴权、错误处理和输出格式；JSON 输出供脚本与智能体稳定消费。
- 复用后端已有检索和治理能力，不在 CLI 中复制服务端实现。

## 边界

- 只通过 RAG 后端 API 工作，遵循后端鉴权和租户权限。
- 不直接访问数据库、向量库、缓存或搜索引擎，不读写项目 `.env`。
- 不自动修改代码，不提交、推送、发布或部署，也不治理后端运行环境。

## 文档入口

- [CLI 项目说明](../../packages/rag-cli/README.md)：命令、配置、安全边界和输出约定。
- [中文使用指南](../../packages/rag-cli/USAGE.zh-CN.md)：安装、登录与命令示例。
- [产品需求](../../packages/rag-cli/docs/CLI_PRD.md) 与[技术架构](../../packages/rag-cli/docs/CLI_ARCHITECTURE.md)：详细设计依据。
- [CLI 实现进度](../../packages/rag-cli/ROADMAP.md)：当前实现状态与验证记录。
- [主项目进度](../../ROADMAP.md)：RAG 服务和整个仓库的进度源。
