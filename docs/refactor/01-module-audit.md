# 模块盘点

以下路径以 backend/src 为前缀，结论来自当前源码及三 Agent 只读审计。`keep` 表示复用现状，`refactor` 表示职责迁出但保留兼容入口，无 delete-candidate 获得删除授权。

| 入口/区域 | 依赖与职责/消费者 | 权威状态与重复问题 | 决策/风险/迁移目标 |
| --- | --- | --- | --- |
| modules/chat/chat.controller.ts → chat.service.ts | HTTP/SSE，身份/会话、规划、分流、收口；AGUI 复用 Chat | PostgreSQL 会话；共享 RequestContext 反向依赖 Chat 目录 | refactor：中立请求契约；事件顺序兼容 |
| rag/rag.service.ts | Chat/Agentic/Document 消费；线性 RAG 编排、召回、RRF/Rerank、生成、BM25 | 文档与索引是外部状态；通用策略已抽到 Evidence/Retrieval/Generation | refactor：能力 token 已建立；Karpathy 旧目录已删除；下一步拆索引仓储与回答编排 |
| rag/evidence/evidence-bundle.ts | 候选/引用/诊断统一收口 | 已存在统一 Bundle，不再造一份 | keep：改为中立类型导入 |
| rag/agentic/agentic-rag.service.ts | LangGraph 节点、规划、检索/生成/反思、审批 | Checkpointer 保存执行位置；三种 Evidence fallback 与 Simple 不一致 | refactor：显式 RAG 能力接口；保留恢复语义 |
| modules/document/document.controller.ts → document.service.ts | 同步上传、URL；异步经 Queue/Worker 回到相同入库路径 | PG 文档/Chunks 权威；Milvus/BM25/ES/Graph 派生 | refactor：索引协调与补偿；生命周期/ACL 不改变 |
| modules/document/document-task.service.ts / document-queue.service.ts | 任务与 BullMQ 生命周期 | task 状态与队列职责已拆开 | keep：不重造任务队列 |
| modules/document/document-image-ingestion.service.ts / document-permission.service.ts | 图片资产索引/路径校验、ACL | 已存在独立职责 | keep：索引协调复用原行为 |
| modules/document/document-parser.util.ts | 格式解析由 Controller/Worker 复用 | 原件/解析结果不能被重建索引删除 | refactor 候选：按真实胶水边界评估，不机械按格式拆分 |
| modules/obsidian | 双写知识源、治理和受控降级资产 | Obsidian/PG 与派生索引职责并存 | keep：作为知识来源适配，避免第二套通用检索 |
| modules/agent-loop / agent-runtime | Loop 工具执行；Runtime Plan/岗位运行编排 | 不是同一业务层，不能按命名合并 | keep/refactor：只提取重复预算/事件逻辑 |
| modules/agent-runs / agent-tasks / agent-runtime-events | Run 观测、Task DAG/状态投影、事件 | 持久记录/任务投影/事件不等于 Checkpoint | keep：明确权威和关联 ID |
| modules/workflow / supervisor / agent-collaboration | 业务岗位 DAG、监督与多 Agent 协作 | Workflow 特定业务，不替换 LangGraph | keep：局部重试、批准产物保留 |
| modules/artifacts / rag/agentic/*artifact* | 文件产物与 Agentic state/payload 输出 | 对象/版本/权限与节点状态并不等价 | keep：保留 ID、revision 与旧记录兼容 |
| modules/rag-gateway / rag-admin / rag-ops-api | 网关身份、运营接口、内部 HTTP 边界 | 公开接口已有调用方 | keep：以 Facade/API 契约收口，不删路由 |
| providers / tools | LLM、向量、ES、工具/外部协议 | 外部副作用不具备 exactly-once | keep：保留取消、重试、租户过滤 |
| admin-backend/modules/rag-client | HTTP 调用 backend 运营 API | 后台身份/业务与 RAG 隔离 | keep：不 import RAG 内部 Service |
| frontend / admin / rag-cli / tools/rag-mcp-server | API/SSE/AGUI/MCP 消费 | 外部 DTO/事件为兼容边界 | keep：不要求消费者同步改动 |

核心调用链：ChatController / AguiService → ChatService → QueryPlanner/Router → RagService 或 Agentic → 共享检索/证据 → Providers。DocumentController/Worker → 双写入口 → DocumentService → 原件/PG/权限 + 派生索引。审批恢复从 Chat/Agentic 的原身份与 checkpoint revision 进入，不能由 RequestContext 搬迁改变校验。
