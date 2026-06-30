# 剩余 P2 增强项及红线项实施方案

> 日期：2026-06-30 | 状态：待确认 | 类型：总览方案

本文档汇总所有需要你确认后才能推进的事项，按依赖关系排序。

---

## 一、BullMQ 异步任务队列

**问题**：文档处理（切片、Embedding、向量入库）当前在请求线程内同步执行，大文件阻塞 HTTP。

**方案**：详见 `docs/async-task-queue-plan.md`

**需要你确认**：
- [ ] 安装 `@nestjs/bullmq` + `bullmq` 依赖
- [ ] 允许使用 Redis 做队列后端（已有 `RedisModule`）

---

## 二、短期记忆产品化

**现状**：Redis 已接入，`RedisModule` 已存在。但滑动窗口、摘要生成、上下文注入策略尚未产品化。

**方案**：

1. 在 `MemoryModule` 或 `ChatModule` 中新增短期记忆 Service
2. Redis 中按 `sessionId` 存储最近 N 轮对话
3. 当对话超过窗口大小时，调用 LLM 生成摘要并替换旧消息
4. 每次新请求注入：最近消息 + 历史摘要
5. 管理后台提供记忆查看和清理入口

**依赖**：无外部依赖（只改代码），可立即实施。

**需要你确认**：
- [ ] 同意实施短期记忆产品化（不需要修改环境变量或 schema）

---

## 三、长期记忆管理可视化（Mem0）

**现状**：Mem0 Provider 已实现（cloud/local 双模式），`MemoryService` 已实现搜索/写入/分类器，`/api/v1/memories` 已有 GET/DELETE 接口。

**可填的缺口**：
- 管理后台 Mem0 记忆管理页面（查看/清理/开关用户级记忆）
- Mem0 审计记录（谁在什么时候检索了什么记忆）

**依赖**：admin 前端开发，不碰红线。

**需要你确认**：
- [ ] 同意实施管理后台 Mem0 记忆管理页面

---

## 四、Deployment 部署准备

**现状**：`docker/docker-compose.yml` 存在，`backend/Dockerfile` 存在，但缺少生产部署的完整流程和 checklist。

**需要准备的文件**：

1. **`DEPLOYMENT_CHECKLIST.md`**：生产部署前逐一确认的清单
   - 域名、SSL 证书、反向代理
   - `.env` 生产配置清单
   - Milvus/PostgreSQL/Redis/ES/Neo4j 连接确认
   - 外部 key 清单（Qwen、Bocha、Rerank、ASR/TTS 等）
   - 备份策略
   - 监控告警
2. **`scripts/deploy.sh`**：一键部署脚本（服务器初始化 → 构建 → 启动）

**红线**：不实际修改 `.env`、CI/CD 或执行部署。只出文档和脚本模板。

**需要你确认**：
- [ ] 同意我创建部署文档和脚本模板（不实际执行）

---

## 五、视觉/视频模型接入（P2）

**现状**：Vision Provider 脚手架已完成（interface + mock + openai-compatible + module）。
`VISION_PROVIDER=mock` 时可在无 key 情况下开发运行。

**遗留项**：
1. Vision Provider 集成到文档上传流程（图片上传后自动调用 OCR/图像理解）
2. 视频上传后调用 `describeVideo`
3. 管理后台视觉处理状态展示

**依赖**：
- VISION_API_KEY 或 QWEN_VL_API_KEY 就位后才能真实联调
- 无 key 时可继续用 mock provider 做开发和测试

**可以现在做的**：
- 集成 mock provider 到文档上传流程（已有 `document-parser.util.ts`）
- 编写集成测试

---

## 六、真实数据替换（P0/P1）

所有 P0/P1 事项都依赖你提供真实数据：

| 事项 | 你提供 | 我能做 |
|------|--------|--------|
| 真实公司私密原件 | 制度文档/音视频/截图文件 | 替换 `eval/private-*` 后运行评测 |
| 真实 GraphRAG 业务数据 | 实体类型/关系/初始语料 | 导入 Neo4j 后校验 |
| 真实组织架构数据 | 部门/岗位/继承规则 | 导入 admin-backend 后验证权限 |

---

## 优先级建议

1. ✅ **立即能做的**：短期记忆产品化、Mem0 管理页面、部署文档
2. ⏳ **等你确认依赖后**：BullMQ 异步队列、Vision Provider 集成到上传流程
3. 🔴 **依赖你提供输入**：真实数据替换、视觉 API key 联调

你想先从哪个方向推进？
