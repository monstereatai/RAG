# 验证记录

基线见 00-baseline.md。后续每批命令/退出码/用例数量写 progress.md，机器报告放 evidence/。Level A：Mock 单元/契约；Level B：本地服务/真实三模式；Level C：私有业务集、生产 IAM 与压力/故障。不同级别不能互相替代。

P1a：EvidencePolicy、EvidenceBundle、线性 RagService、Agentic 相关单测；backend build；新文件 lint 与九个既有文件诊断基线比较。P2：Document/Queue/Parser/Permission 及补偿测试。P3-P5：Chat/Context/Runtime/审批与事件契约。P6：全仓构建、现有单测及可用离线评测；三模式真实入口先检查本地环境。

旧失败保留并与新报告比较；不删除断言、不 skip，不把离线 Mock 结果当作准确率、成本、延迟或生产隔离证明。

## 当前证据层级

| 证据 | 结论与时点 |
| --- | --- |
| evidence/workspace-build.txt | 当前六 workspace 构建 PASS；后续窄接口 implements 的 backend 编译见 backend-build.txt |
| evidence/backend-build.txt | 最新 backend build PASS |
| evidence/retrieval-tests.json | 5 suites / 21 tests PASS，覆盖有效时间解析、ES 区间过滤、生命周期、召回降级和 Scope 兼容 |
| evidence/runtime-tests.json | 17 suites / 80 tests PASS；不等于外部恢复或生产故障验收 |
| evidence/integration-tests.json | 最终拆分后 5 suites / 95 tests PASS（RAG、Agentic、Chat、Document 索引协调、RAG Gateway）；是定向回归，不是全量 Jest 或真实三模式验收 |
| evidence/full-jest.txt | 全量 Jest：113 suites 中 106 PASS、7 FAIL；590 tests 中 570 PASS、20 FAIL；失败集中在本轮未改动模块 |
| evidence/smoke-rag-pipeline.txt | 线性 RAG + RAG Gateway + ES kNN + Rerank 脚本冒烟 40/40 PASS |
| evidence/new-code-lint.json | 当前 24 个 RAG 组件/迁移文件 ESLint 0 error / 0 warning |
| evidence/rag-architecture-lint.json | 24 个 RAG 组件/迁移文件 ESLint 0 error / 0 warning；不等于全仓 lint 全绿 |
| evidence/p1-lint-delta.txt | ESLint 基线差异检查无新增诊断（baseline 90 / current 38） |
| evidence/scope-and-contract.json | 用户原始改动保留、64 个契约源码哈希对比 |

本轮拆分、定向回归、构建和 smoke 已完成；全量 Jest 仍有 7 个非本轮模块 suite 失败，失败集合与重构前基线一致；真实三模式、质量/成本/延迟和故障/压力验证仍未运行，不能以 Mock 结果替代生产验收。
