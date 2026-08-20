# Agent Course 内容总结

本仓库是一个 AI Agent / RAG / LLM 应用开发系列课程实战代码合集，涵盖从 LangChain 基础（Prompt/Runnable/Output Parser/Tool）、RAG 基础到进阶（Milvus/pgvector/ES/Neo4j GraphRAG）、LangGraph 图编排、DeepAgents 全家桶、记忆系统（Redis/Mem0）、语音（腾讯云 ASR/TTS）、定时任务、评测、NestJS 工程化（JWT/Docker/TypeORM）等完整技术栈。每个子目录为一个独立章节项目。

## 章节总览

| 章节 | 目录 | 核心主题 | 技术栈 |
|------|------|----------|--------|
| 1 | prompt-template-test | Prompt 模板 | LangChain PromptTemplate |
| 2 | runnable-test | LangChain Runnable | RunnableSequence/Lambda/Map/Branch/WithMessageHistory |
| 3 | output-parser-test | 输出解析器与结构化输出 | Zod/JsonOutputParser/MySQL 智能导入/mini-cursor |
| 4 | tool-test | 工具调用与 MCP | LangChain Tools/MCP SDK/MCP Adapters |
| 5 | rag-test | RAG 基础 | MemoryVectorStore/TextSplitter/Document Loader |
| 6 | milvus-test | Milvus 向量库与电子书 RAG | Milvus/EPubLoader/RecursiveCharacterTextSplitter |
| 7 | pgsql-test | PostgreSQL + pgvector | pg/HNSW 索引/余弦检索 |
| 8 | typeorm-pg-crud | TypeORM + pgvector CRUD | NestJS/TypeORM/pgvector 语义检索 |
| 9 | redis-test | Redis 基础与 Agent 短期记忆 | ioredis/summarizationMiddleware |
| 10 | neo4j-graphrag | Neo4j 知识图谱 RAG | Neo4j/Cypher/LangGraph/GraphRAG |
| 11 | advanced-rag | 高级 RAG（朴素/多跳/路由/联网兜底） | LangGraph + Milvus + Zod |
| 12 | es-test | Elasticsearch 与混合检索 | ES + Milvus + DashScope Rerank |
| 13 | hello-nest-langchain | NestJS + LangChain 入门 | NestJS + LangChain LCEL |
| 14 | nest-feature | NestJS 进阶特性 | JWT/Guards/Interceptors/Pipes/Filters |
| 15 | nest-dockerfile-test | NestJS Docker 部署 | Dockerfile 多阶段/MySQL/Milvus Compose |
| 16 | langgraph-test | LangGraph 图编排 | StateGraph/Checkpointer/Supervisor |
| 17 | deepagents-test | DeepAgents 能力演练 | DeepAgents 五大中间件 + QuickJS |
| 18 | deep-research-assistant | 深度调研助手 | DeepAgents + 子Agent + Skills |
| 19 | agui-backend | Agent GUI 后端 | NestJS + LangChain Agent + AI SDK |
| 20 | agui-frontend | Agent GUI 前端 | React + Vite + AI SDK |
| 21 | memory-test | 对话历史记忆 | LangChain ChatMessageHistory + Milvus |
| 22 | mem0-test | Mem0 长期记忆 | Mem0 + Redis + LangChain |
| 23 | asr-and-tts-nest-service | 语音识别与合成（NestJS 服务） | NestJS + 腾讯云 ASR/TTS |
| 24 | tts-stt-test | 腾讯云语音基础 | tencentcloud-sdk/ASR/TTS/流式 TTS |
| 25 | cron-job-tool | 定时任务 Agent | NestJS + LangChain + Cron |
| 26 | langsmith-test | RAG 评测 | LangSmith + OpenEvals + Milvus |

---

## 各章核心功能详解

### 1. prompt-template-test — Prompt 模板

LangChain Prompt 模板体系的完整演练。

- **prompt-template1.mjs**：`PromptTemplate.fromTemplate` 基础用法，变量插值生成周报 Prompt
- **partial.mjs**：`partial` 部分插值，分步填充变量
- **chat-prompt-template.mjs / chat-prompt-template2.mjs**：`ChatPromptTemplate` 多角色消息模板
- **messages-placeholder.mjs**：`MessagesPlaceholder` 占位历史消息
- **fewshot-prompt-template.mjs / fewshot-chat-prompt-template.mjs**：Few-shot 示例模板
- **example-selector1.mjs / example-selector2.mjs**：`SemanticExampleSelector` 语义示例选择（Milvus 向量相似度）
- **pipeline-prompt-template.mjs（1/2/3）**：`PipelinePromptTemplate` 管道组合多个子 Prompt
- **weekly-report-examples-writer-milvus.mjs**：综合示例，用 Milvus 语义检索挑选 few-shot 样本

**核心能力**：PromptTemplate、ChatPromptTemplate、MessagesPlaceholder、Few-shot、SemanticExampleSelector、PipelinePrompt 组合。

### 2. runnable-test — LangChain Runnable

LangChain Runnable 接口的全部用法与组合模式。

- **runnable.mjs**：`RunnableSequence` 串联 Prompt → Model → OutputParser
- **runnables/RouterRunnable.mjs**：路由 Runnable，按输入动态分发
- **runnables/RunnableBranch.mjs**：条件分支
- **runnables/RunnableEach.mjs**：对数组逐项执行
- **runnables/RunnableLambda.mjs**：自定义函数封装
- **runnables/RunnableMap.mjs**：并行执行多个 Runnable
- **runnables/RunnablePassthrough.mjs**：透传输入
- **runnables/RunnablePick.mjs**：从对象中挑选字段
- **runnables/RunnableWithCallbacks.mjs**：回调监听
- **runnables/RunnableWithConfig.mjs**：配置注入
- **runnables/RunnableWithFallbacks.mjs**：失败降级
- **runnables/RunnableWithMessageHistory.mjs**：消息历史绑定
- **runnables/RunnableWithRetry.mjs**：自动重试
- **cases/ebook-reader-rag.mjs**：综合案例，Runnable 组合实现电子书 RAG
- **cases/mcp-test.mjs**：Runnable + MCP 工具集成

**核心能力**：LCEL 表达式语言、Runnable 全家族、管道组合、并行/分支/降级/重试/历史/回调。

### 3. output-parser-test — 输出解析器与结构化输出

LLM 结构化输出的完整方案 + 实战案例。

- **normal.mjs**：普通字符串输出
- **json-output-parser.mjs**：`JsonOutputParser` 解析 JSON
- **structured-output-parser.mjs（1/2）**：`StructuredOutputParser.fromZodSchema`
- **structured-json-schema.mjs**：JSON Schema 定义
- **with-structured-output.mjs**：`model.withStructuredOutput`（推荐方式）
- **stream-normal.mjs**：流式普通输出
- **stream-structured-partial.mjs**：流式结构化部分输出
- **stream-tool-calls-parser.mjs / stream-tool-calls-raw.mjs**：流式工具调用解析
- **stream-with-structured-output.mjs**：流式结构化输出
- **tool-calls-args.mjs**：工具调用参数解析
- **xml-output-parser.mjs**：XML 输出解析
- **test/smart-import.mjs**：实战 — LLM 从文本提取好友信息，`withStructuredOutput` + Zod 校验，批量写入 MySQL
- **test/create-table.mjs**：MySQL 建库建表 + 插入 demo 数据
- **test/mini-cursor.mjs**：实战 — 用工具调用循环实现 mini Cursor，读写文件 + 执行命令
- **test/all-tools.mjs**：文件读写、命令执行、目录列举工具集

**核心能力**：Zod Schema、JsonOutputParser、StructuredOutputParser、withStructuredOutput、流式结构化输出、工具调用解析、MySQL 智能导入、mini-cursor Agent 循环。

### 4. tool-test — 工具调用与 MCP

LangChain 工具调用 + Model Context Protocol 全套演练。

- **hello-langchain.mjs**：LangChain 入门 hello world
- **tool-file-read.mjs**：文件读取工具（`tool()` 函数定义）
- **all-tools.mjs**：工具集（read_file/write_file/execute_command/list_directory）
- **node-exec.mjs**：Node 命令执行
- **mini-cursor.mjs**：mini Cursor Agent（工具调用循环，30 轮上限）
- **mcp-test.mjs**：MCP 协议基础
- **my-mcp-server.mjs**：自建 MCP Server（`@modelcontextprotocol/sdk`，注册 query_user 工具 + 资源）
- **langchain-mcp-test.mjs**：`MultiServerMCPClient`（`@langchain/mcp-adapters`）加载 MCP 工具并接入 Agent

**核心能力**：LangChain `tool()` 定义、工具绑定、Agent 循环、MCP Server 构建、MCP Adapters 集成、资源读取。

### 5. rag-test — RAG 基础

RAG 管线的基础组件演练。

- **hello-rag.mjs**：最简 RAG，`MemoryVectorStore` + 内置 Document + 相似度检索 + LLM 生成
- **loader-and-splitter.mjs / loader-and-splitter2.mjs**：Document Loader（cheerio 网页加载）+ TextSplitter
- **tiktoken-test.mjs**：tiktoken token 计数
- **splitters/CharacterTextSplitter-test.mjs**：按字符切分
- **splitters/RecursiveCharacterTextSplitter-test.mjs**：递归字符切分（推荐）
- **splitters/TokenTextSplitter-test.mjs**：按 token 切分
- **splitters/recursive-splitter-code.mjs**：代码切分（按语言语法）
- **splitters/recursive-splitter-latex.mjs**：LaTeX 切分
- **splitters/recursive-splitter-markdown.mjs**：Markdown 切分（按标题层级）

**核心能力**：MemoryVectorStore、Document Loader、TextSplitter 全家族（字符/递归/Token/代码/LaTeX/Markdown）、tiktoken。

### 6. milvus-test — Milvus 向量库与电子书 RAG

Milvus 全套操作 + epub 电子书 RAG 实战。

- **insert.mjs**：写入向量（`MilvusClient` + `DataType`/`MetricType`/`IndexType`）
- **query.mjs**：向量检索
- **update.mjs**：更新向量
- **delete.mjs**：删除数据
- **ebook-writer.mjs**：epub 电子书入库 — `EPubLoader` 加载 → `RecursiveCharacterTextSplitter` 切分（500 字符）→ Embedding → 写入 Milvus collection
- **ebook-query.mjs**：电子书检索
- **ebook-reader-rag.mjs**：电子书 RAG 完整管线（检索 + LLM 生成）
- **rag.mjs**：AI 日记 RAG（collection `ai_diary`，1024 维）

**核心能力**：Milvus CRUD、Collection 创建、HNSW 索引、EPubLoader、RecursiveCharacterTextSplitter、向量检索、RAG 生成。

### 7. pgsql-test — PostgreSQL + pgvector

PostgreSQL + pgvector 向量库的基础演练（纯 SQL + pg 驱动）。

- **create_tables.sql**：建表脚本 — 启用 `vector` 扩展，users/conversations/messages 表，`embedding vector(1024)`，HNSW 索引（`vector_cosine_ops`）
- **src/db.mjs**：`pg` 连接池
- **src/users.mjs / conversations.mjs / messages.mjs**：三张表的 CRUD
- **src/messages.mjs**：`searchSimilarMessages` — pgvector 余弦检索（`1 - (embedding <=> $1::vector) AS similarity`）
- **src/index.mjs**：完整 demo — 用户/会话/消息 CRUD + 语义检索
- **docker-compose.yml**：`pgvector/pgvector:pg16` + pgAdmin
- **init-scripts/create_tables.sql**：容器启动自动建表

**核心能力**：pgvector 扩展、vector 类型、HNSW 索引、`<=>` 余弦距离运算符、`pg` 驱动、pgAdmin GUI。

### 8. typeorm-pg-crud — TypeORM + pgvector CRUD

NestJS + TypeORM + pgvector 的会话语义检索服务。

- **entities/user.entity.ts**：用户实体（`@PrimaryGeneratedColumn`、`@OneToMany` 关联 conversations）
- **entities/conversation.entity.ts**：会话实体（`@ManyToOne` User、`@OneToMany` Message）
- **entities/message.entity.ts**：消息实体（`@Column('vector', { length: 1024 })` 存 embedding，`MessageRole` 枚举）
- **conversations.service.ts**：
  - `findConversationsByUserId`：用户 → 会话列表（关联查询）
  - `findMessagesByConversationId`：会话 → 消息列表
  - `searchSimilarMessages`：会话内语义检索（`em.query` 执行 pgvector SQL，`1 - (embedding <=> $1::vector)`）
  - `OpenAIEmbeddings` 生成 embedding（text-embedding-v3，1024 维）
- **conversations.controller.ts**：REST 接口（`GET /conversations/users/:userId`、`GET /conversations/:id/messages`、`POST /conversations/:id/search`）
- **app.module.ts**：`TypeOrmModule.forRoot`（type: 'postgres'，synchronize: true）

**核心能力**：TypeORM 实体关系（一对多/多对一）、pgvector 列类型、原生 SQL 语义检索、OpenAIEmbeddings 集成、NestJS REST API。

### 9. redis-test — Redis 基础与 Agent 短期记忆

Redis 数据类型 + Agent 短期记忆方案。

- **src/redis-test.mjs**：Redis 6 大数据类型 demo
  - String（验证码/Token/计数器/分布式锁 `NX EX`）
  - Hash（用户信息）
  - List（任务队列 `lpush/rpush`）
  - Set（标签）
  - ZSet（排行榜 `zadd/zrange`）
  - 分布式锁（`set key value NX EX`）
- **src/agent-with-redis-memory.mjs**：Agent + Redis 短期记忆
  - `RedisMessageStore`：`loadMessages`/`saveMessages`（带 TTL，`mapChatMessagesToStoredMessages` 序列化）
  - `summarizationMiddleware`：消息超 8 条触发摘要压缩，保留最近 4 条
  - invoke 前加载历史、invoke 后写回 Redis
  - 交互式 CLI，支持 `:clear` 清空记忆
- **redis-data-types.md**：Redis 数据类型业务场景速查（验证码/Token/计数器/分布式锁/会话/排行榜/AI 摘要）
- **docker-compose.yml**：Redis 7 + RedisInsight GUI

**核心能力**：ioredis、Redis 6 大数据类型、分布式锁、Agent 短期记忆、消息序列化、summarizationMiddleware 自动压缩、TTL 过期。

### 10. neo4j-graphrag — Neo4j 知识图谱 RAG

Neo4j 图数据库 + LangGraph 实现 GraphRAG（奶茶知识图谱）。

- **src/neo4j-test.mjs**：Neo4j 基础 — `neo4j-driver` 连接、创建节点（Product/Ingredient）、创建关系、Cypher 查询
- **src/graphrag.mjs**：GraphRAG 工作流
  - `Neo4jGraph`（`@langchain/community/graphs/neo4j_graph`）连接图库
  - LangGraph StateGraph 三节点：`generateCypher`（LLM 生成 Cypher）→ `executeGraphQuery`（执行图查询）→ `generateAnswer`（基于结果生成答案）
  - 节点：Product（奶茶）/ Ingredient（配料）/ Type（类型）/ Method（工艺）/ People（适合人群）
  - 关系：(Product)-[:属于]->(Type)、(Product)-[:包含]->(Ingredient)、(Product)-[:适合]->(People)、(Ingredient)-[:使用]->(Method)
  - Mermaid 图导出
- **docker-compose.yml**：Neo4j + APOC 插件
- **cypher.md / cypher2.md**：Cypher 语法速查

**核心能力**：Neo4j 图数据库、Cypher 查询语言、Neo4jGraph 集成、LangGraph GraphRAG 工作流、LLM 生成 Cypher、Mermaid 可视化。

### 11. advanced-rag — 高级 RAG 技术

基于《天龙八部》小说知识库（Milvus 向量库）的 RAG 进阶演练，使用 LangGraph 编排，共 4 个递进示例：

- **naive-rag.mjs**：朴素 RAG。`retrieve → generate` 两节点线性图，向量检索 Top-K 片段后流式生成回答。
- **rag-query-router.mjs**：查询路由。先用 LLM 结构化输出判断 `simple`/`complex`，simple 直接回答，complex 走 RAG 检索再生成。
- **rag-multihop.mjs**：多跳问答。复杂问题先拆解为有序子问题序列，逐条向量检索并去重合并，规划器决定是否继续检索或生成，支持多轮检索上限。
- **rag-webfallback.mjs**：联网兜底。本地检索后由评估器判断上下文是否充分，不足时调用 Bocha Web Search 联网补充，再二次评估后生成。

**核心能力**：StateGraph 状态机、条件路由、结构化输出（Zod）、流式生成、向量检索、多跳推理、联网兜底。

### 12. es-test — Elasticsearch 与混合检索

ES 基础操作 + 进阶混合检索 + Rerank。

- **es-test.md / es-test2.md / es-test3.md**：ES REST API 速查（索引创建、文档 CRUD、分词检索、分页排序、批量删除等）
- **src/create.mjs / operate.mjs**：ES 索引与文档操作
- **src/rag/query-augment.mjs**：用 LLM 生成 3 条多角度检索问句
- **src/rag/hybrid-retrieval.mjs**：混合检索核心
  - LangGraph 编排：`query_augment → es_recall ∥ milvus_recall → merge → rerank → generate_answer`
  - ES 关键词检索（multi_match + ik_smart 分词）与 Milvus 向量检索并行
  - 按 id 去重合并，DashScope Rerank 重排取 Top-N
- **src/rerank/dashscope-rerank.mjs**：DashScope Rerank 实现（继承 BaseDocumentCompressor）
- **src/rag/seed-data.mjs**：种子数据
- **docker-compose.yml**：ES + Kibana 部署

**核心能力**：ES 全文检索、Milvus 向量检索、混合检索融合、查询扩展（Query Augmentation）、Rerank 重排、LangGraph 并行节点、IK 中文分词。

### 13. hello-nest-langchain — NestJS + LangChain 入门

最简 NestJS + LangChain 集成示例。

- **ai.service.ts**：用 `PromptTemplate` + `ChatOpenAI` + `StringOutputParser` 组成 Chain
- 提供 `runChain`（同步）和 `streamChain`（流式）两种调用
- **book 模块**：完整 CRUD 示例（controller/service/entity/dto）
- **sse-test.html**：SSE 流式测试页

**核心能力**：NestJS 依赖注入 LangChain、LCEL Chain 表达式、Prompt 模板、流式输出、TypeORM CRUD。

### 14. nest-feature — NestJS 进阶特性

NestJS 企业级开发核心特性的完整演练。

- **auth/auth.service.ts**：Token 验证服务（模拟 Token → 用户映射）
- **jwt-test/**：JWT 模块（`@nestjs/jwt`，签发与验证）
- **common/guards/auth.guard.ts**：`AuthGuard` — Bearer Token 提取 + 用户校验 + 资源权限（admin 可访问所有，普通用户只能访问自己）
- **common/decorators/current-user.decorator.ts**：`@CurrentUser()` 自定义装饰器提取当前用户
- **common/interceptors/transform.interceptor.ts**：`TransformInterceptor` — 统一响应格式（`{code, data, message}`）+ 请求耗时日志
- **common/filters/all-exceptions.filter.ts**：全局异常过滤器
- **common/pipes/parse-age.pipe.ts / parse-positive-int.pipe.ts**：自定义管道（参数校验）
- **common/interfaces/api-response.interface.ts**：`ApiResponse`、`JwtPayload` 接口
- **user/**：用户模块 CRUD（entity/dto/controller/service）
- **curl-test.md / curl-test2.md**：接口测试用例

**核心能力**：JWT 认证、AuthGuard 守卫、自定义装饰器、拦截器（统一响应/日志）、异常过滤器、管道校验、RBAC 权限控制。

### 15. nest-dockerfile-test — NestJS Docker 部署

NestJS 容器化部署的完整方案。

- **Dockerfile**：多阶段构建（builder 阶段 `npm install` + `nest build`，运行阶段仅生产依赖 + 编译产物，镜像更小）
- **Dockerfile2**：单阶段构建（含 `@nestjs/cli` 全局安装）
- **docker-compose.dev.yml**：开发环境 — MySQL + Milvus（etcd + minio + standalone）完整栈
- **docker-compose.prod.yml**：生产环境 — MySQL + NestJS 应用容器
- **src/book/**：Book CRUD 模块（TypeORM + MySQL）
- **src/app.module.ts**：`TypeOrmModule.forRoot`（type: 'mysql'，`connectorPackage: 'mysql2'`，环境区分 host）
- **ServeStaticModule**：静态文件服务（`/books` 路径）
- **public/index.html**：静态页面

**核心能力**：Docker 多阶段构建、docker-compose 多环境（dev/prod）、MySQL + Milvus 容器编排、TypeORM MySQL 集成、静态文件服务、npm 镜像加速。

### 16. langgraph-test — LangGraph 图编排

LangGraph 核心特性的系列 demo：

- **basic-graph.mjs**：最简线性图（step1 → step2），演示 StateGraph + Annotation
- **conditional-routing.mjs**：条件路由（数学表达式走 math 节点，否则走 chat 节点）
- **loop-retry.mjs**：循环重试（失败重试直到成功，条件边回到自身）
- **graph-interrupt.mjs**：图中断（`interrupt` 暂停等待用户确认转账，`Command.resume` 恢复）
- **checkpointer-memory.mjs**：内存检查点（MemorySaver 按 thread_id 隔离不同会话状态）
- **checkpointer-sqlite.mjs**：SQLite 持久化检查点
- **prebuilt-agent.mjs**：预构建 Agent（createAgent + MemorySaver + 工具）
- **prebuilt-tool-node.mjs**：预构建 ToolNode + toolsCondition（标准 ReAct 循环）
- **multi-agent-supervisor.mjs**：多 Agent 监督者（Supervisor 调度 weather_agent / trivia_agent）
- **trigger-error.mjs**：故意抛错，用于观察 LangSmith 错误追踪

**核心能力**：StateGraph、Annotation 状态、条件边、循环、中断恢复、Checkpointer（内存/SQLite）、预构建 Agent、ToolNode、Supervisor 多 Agent、Mermaid 图导出。

### 17. deepagents-test — DeepAgents 能力演练

DeepAgents 各项中间件的独立 demo：

- **filesystem-agent.mjs**：文件系统中间件，演示权限控制（deny/allow 规则，读写路径白名单）
- **memory-agent.mjs**：记忆中间件，分层记忆（项目 AGENTS.md + 用户 preferences.md）
- **skills-agent.mjs**：技能中间件，加载 excalidraw-diagram-generator 技能生成流程图
- **subagent-agent.mjs**：子 Agent 中间件，小学数学辅导场景（math-solver 解题 → kid-tutor 讲题 → practice-maker 出题）
- **summarization-agent.mjs**：摘要中间件，超阈值自动摘要历史对话并落盘
- **middleware-test.mjs / middleware-test2.mjs**：中间件组合测试

**核心能力**：DeepAgents 五大中间件（Filesystem、Memory、Skills、SubAgent、Summarization）逐一演练、权限模型、分层记忆、QuickJS 代码解释器。

### 18. deep-research-assistant — 深度调研助手

基于 DeepAgents 的综合实战项目，产出中文调研报告。

- **agent.mjs**：主 Agent 工厂，编排 researcher/editor/analyst 三个子 Agent
  - `researcher`：联网搜索调研单一子主题（最多 3 次搜索）
  - `editor`：审阅报告草稿，给修改建议
  - `analyst`：用 QuickJS REPL 做数值计算与数据分析
- **cli.mjs**：CLI 入口，接收调研主题
- **tools/search.mjs**：Bocha 联网搜索工具
- **skills/**：`web-research`（调研流程）、`report-writer`（报告模板）技能
- **AGENTS.md**：长期记忆（中文报告偏好、调研标准、工作区约定）
- 工作流：规划 → 调研 → 分析 → 起草 → 审阅 → 定稿

**核心能力**：DeepAgents 全家桶（write_todos、文件系统、子Agent、Skills、Memory、REPL、Streaming）、多 Agent 协作、中文报告生成。

### 19. agui-backend — Agent GUI 后端

NestJS 后端，提供带工具调用的 Agent 流式聊天接口。

- 使用 `createAgent` 创建 Agent，绑定 `web_search` 和 `send_mail` 工具
- 通过 `@ai-sdk/langchain` 的 `toUIMessageStream` 将 LangChain 流转换为 AI SDK 格式
- 支持 CORS 跨域，端口 3000

**核心能力**：NestJS + LangChain Agent 集成、AI SDK 协议转换、工具调用、流式响应。

### 20. agui-frontend — Agent GUI 前端

React + Vite 前端，对接 agui-backend 的聊天界面。

- 使用 `@ai-sdk/react` 的 `useChat` Hook 管理对话状态
- `ToolPanels` 组件渲染工具调用过程（文本流、工具面板）
- `StreamdownText` 组件渲染流式 Markdown
- 支持停止生成、错误提示、状态显示

**核心能力**：AI SDK 前端集成、流式消息渲染、工具调用可视化、React 对话 UI。

### 21. memory-test — 对话历史记忆

LangChain 对话历史的多种存储方案。

- **history-test.mjs**：`InMemoryChatMessageHistory` 内存存储（进程内）
- **history-test2.mjs**：`FileSystemChatMessageHistory` 文件存储（chat_history.json）
- **history-test3.mjs**：文件存储 + 多轮恢复（从文件恢复历史继续对话）
- **memory/insert-conversations.mjs**：将对话存入 Milvus 向量库（用于后续 RAG 检索历史对话）

**核心能力**：LangChain ChatMessageHistory 抽象、内存/文件/Milvus 三种存储、会话恢复、对话向量化。

### 22. mem0-test — Mem0 长期记忆

Mem0 记忆系统的多种用法。

- **mem0-test.mjs**：Mem0 基础 API（add/search/getAll/update/history/deleteAll）
- **mem0-local-api-demo.mjs**：本地 API 部署 demo
- **mem0-scoped-memory-test.mjs**：作用域记忆测试（user_id + run_id 分层）
- **mem0-redis-mem0-agent.mjs**：Redis + Mem0 双层记忆 Agent
  - Redis：短期会话历史（带 TTL），超阈值自动摘要压缩
  - Mem0：长期记忆，分 user 层（跨会话）和 session 层（当前会话）
  - 分类器 LLM 判断每轮对话该写入哪层
  - 交互式 CLI，支持 `:clear` / `:clear-mem0` 命令
- **docker-compose.yml**：Redis 部署

**核心能力**：Mem0 记忆 CRUD、分层记忆（user/session）、Redis 短期记忆 + Mem0 长期记忆、记忆分类器、对话摘要压缩、跨会话记忆保持。

### 23. asr-and-tts-nest-service — 语音识别与合成（NestJS 服务）

NestJS 服务，集成腾讯云语音能力。

- **speech.service.ts**：ASR 语音识别，将音频（ogg-opus）转文字
- **tts-relay.service.ts**：TTS 文字转语音中继
- **ai.service.ts**：AI 对话服务
- **controller.service.ts**：控制器编排
- 提供 `asr.html`、`asr-ai-stream.html` 测试页面

**核心能力**：腾讯云 ASR 一句话识别、TTS 语音合成、音频流处理、AI + 语音联动。

### 24. tts-stt-test — 腾讯云语音基础

腾讯云语音 SDK 的基础调用（非 NestJS，纯 Node 脚本）。

- **src/tts-test.mjs**：TTS 文字转语音（`tencentcloud-sdk-nodejs-tts`，生成 mp3）
- **src/asr-test.mjs**：ASR 语音识别（`tencentcloud-sdk-nodejs`，mp3 → 文字）
- **src/streaming-tts-test.mjs**：流式 TTS（WebSocket 实时合成）
- **output.mp3 / output2.mp3 / output3.mp3**：TTS 生成产物

**核心能力**：腾讯云 TTS 合成、ASR 识别、WebSocket 流式 TTS、音频文件处理。

### 25. cron-job-tool — 定时任务 Agent

NestJS 服务，Agent 可创建和管理服务端定时任务。

- **ai.service.ts**：通用任务助手，绑定 6 个工具（query_user、send_mail、web_search、db_users_crud、time_now、cron_job），支持流式与非流式
- **job-agent.service.ts**：定时任务执行器，到点时按 instruction 调用工具完成任务
- **cron-job-tool.service.ts**：定时任务管理工具，支持 `list`/`add`/`toggle`，三种类型：`cron`（表达式）、`every`（间隔）、`at`（一次性）
- **job.service.ts** + **job.entity.ts**：任务实体与调度逻辑
- 含 users 模块（CRUD）、多种工具服务（邮件、搜索、时间、DB）

**核心能力**：Agent 工具调用循环、定时任务调度（cron/every/at）、自然语言转定时任务、TypeORM、工具注入。

### 26. langsmith-test — RAG 评测

LangSmith + OpenEvals 的 RAG 评测闭环。

- **rag_agent.mjs**：RAG Agent（Milvus 检索 + LLM 生成），LangGraph 编排 `retrieve → generate`
- **cli.mjs**：命令行问答入口
- **milvus_insert.mjs**：向 Milvus 写入文档
- **eval/build_dataset.mjs**：构建 LangSmith Dataset（问题 + 标准答案）
- **eval/evaluators.mjs**：三大 RAG 评测指标
  - `rag_groundedness`：忠实度（答案是否被上下文支撑，防幻觉）
  - `rag_helpfulness`：有用性（是否切题）
  - `rag_retrieval_relevance`：检索相关性（召回片段是否相关）
- **eval/run_eval.mjs**：评测入口，跑 Dataset + 评测器，输出 LangSmith 报告链接
- **data/**：评测用文档（会员、支付、售后、物流等）

**核心能力**：LangSmith Dataset 管理、OpenEvals LLM-as-Judge 评测、RAG 三大指标、评测实验与报告、Milvus 向量检索。

---

## 技术栈总结

### LLM 框架
- **LangChain**：PromptTemplate、Runnable（LCEL）、Output Parser、Tool、Document Loader、TextSplitter、ChatMessageHistory
- **LangGraph**：StateGraph、条件路由、循环、中断恢复、Checkpointer（Memory/SQLite）、Supervisor 多 Agent、Mermaid 导出
- **DeepAgents**：五大中间件（Filesystem、Memory、Skills、SubAgent、Summarization）、QuickJS REPL
- **AI SDK**：`@ai-sdk/react`（useChat）、`@ai-sdk/langchain`（协议转换）
- **MCP**：`@modelcontextprotocol/sdk`（Server）、`@langchain/mcp-adapters`（Client）

### 向量库与检索
- **Milvus**：`@zilliz/milvus2-sdk-node`，HNSW 索引，CRUD + RAG
- **PostgreSQL + pgvector**：`vector` 扩展，HNSW 索引，`<=>` 余弦距离
- **Elasticsearch**：IK 中文分词，multi_match，混合检索
- **Neo4j**：图数据库，Cypher，GraphRAG（LLM 生成 Cypher）
- **MemoryVectorStore**：内存向量库（轻量 demo）

### 数据库与缓存
- **PostgreSQL**：`pg` 驱动 + TypeORM
- **MySQL**：`mysql2` 驱动 + TypeORM
- **Redis**：`ioredis`，6 大数据类型 + 分布式锁 + Agent 短期记忆
- **Neo4j**：`neo4j-driver` + `@langchain/community/graphs/neo4j_graph`

### 后端框架
- **NestJS**：依赖注入、TypeORM、JWT（`@nestjs/jwt`）、Guards、Interceptors、Pipes、Filters、`@nestjs/serve-static`、`@nestjs/throttler`、`@nestjs/schedule`
- **Docker**：多阶段构建、docker-compose 多环境（dev/prod）、MySQL/Milvus/Redis/ES/Neo4j 容器编排

### 前端框架
- **React + Vite**：`@ai-sdk/react`（useChat）、流式 Markdown、工具调用可视化

### 记忆系统
- **Mem0**：长期记忆（user/session 分层）、CRUD、分类器
- **Redis**：短期记忆 + TTL + summarizationMiddleware 自动压缩
- **LangChain ChatMessageHistory**：内存/文件/Milvus 三种存储

### 评测
- **LangSmith**：Dataset 管理、实验追踪、报告
- **OpenEvals**：LLM-as-Judge，RAG 三大指标（忠实度/有用性/检索相关性）

### 语音
- **腾讯云 ASR**：一句话识别（`tencentcloud-sdk-nodejs`）
- **腾讯云 TTS**：语音合成（`tencentcloud-sdk-nodejs-tts`）、WebSocket 流式 TTS

### 模型
- **通义千问**：qwen-plus / qwen-turbo
- **OpenAI 兼容接口**：ChatOpenAI + OpenAIEmbeddings（text-embedding-v3，1024 维）

### 工具
- **Bocha 搜索**：联网检索
- **DashScope Rerank**：`BaseDocumentCompressor` 重排
- **QuickJS REPL**：`quickjs-emscripten` 代码执行沙箱
- **MCP 工具**：自定义 MCP Server + MCP Adapters 接入
