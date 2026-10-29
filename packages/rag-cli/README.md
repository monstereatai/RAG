# RAG CLI 命令行工具

面向开发者、脚本和编码智能体的 RAG 知识库网关。CLI 通过后端 API 完成检索、问答和上下文整理，不直接访问数据库、向量库或项目 `.env`。

## 文档

- [中文使用指南](./USAGE.zh-CN.md)：安装、配置、认证和命令示例。
- [产品需求](./docs/CLI_PRD.md)：功能范围和输出约定。
- [技术架构](./docs/CLI_ARCHITECTURE.md)：模块分层和后端调用边界。
- [实现进度](./ROADMAP.md)：当前状态、待办和验证记录。

## 构建与验证

```bash
pnpm install
pnpm run build
pnpm test
node dist/src/bin.js --help
node dist/src/bin.js doctor --format json
```

本地运行构建产物：

```bash
node dist/src/bin.js search "查询内容"
```
