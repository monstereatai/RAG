# 课程实现边界与校正

本页依据 2026-09-04 当前工作区源码审阅。表中“确认”是代码事实，真实服务行为另行实验验证。课程更新不修改业务运行代码。

| 内容 | 当前可确认的事实 | 教学与验收要求 |
| --- | --- | --- |
| BM25（关键词相关性算法） | `tokenize` 去重使匹配词 tf（词频）为 1，长度按唯一词项数统计 | 是项目简化，不是标准词频实现；不能声称体积固定减半或效果天然可接受 |
| IDF（逆文档频率） | `log(N/df)` 在有效 df 范围不为负；未平滑的 `log((N-df+0.5)/(df+0.5))` 在 df>N/2 时为负 | 两个公式不能混写 |
| 余弦相似度 | 一般范围为 [-1,1]，服务可能另做转换 | 解释融合要说分数分布与标度不同，而非假定都为概率 |
| 三模式 | 当前 `run` 入口结合快速检索门禁与复杂度处理模式 | `routeNode` 的单独函数体不是完整线上路由；不能按字数独立升级 |
| Chat（问答）审批 | `humanApprovalNode` 发事件并返回 pending（待审批）；条件边仅 rejected（拒绝）进入结束，pending 仍去 reflection（反思） | 已发现图未在此处真正暂停的实现问题；`resumeGraph` 用带输入的 invoke（调用）也不能证明只执行剩余节点 |
| Agent Loop（循环）快照 | `run` 从 initialState（初始状态）与新计数开始；快照写成功轮状态；无自动读取恢复分支 | 保存状态不能证明完整恢复预算与执行位置；未知副作用须先核对远端结果 |
| 快照截断 | `slice(0,100000)` 按字符截断 JSON（结构化文本），不是 100KB 字节安全序列化 | 大状态可能不可解析；stateHash（状态摘要）不能还原被截断数据 |
| Redis（缓存数据库）异常 | 循环在 Redis 禁用时记录 skipped（跳过）；启用时写失败路径需单独验证 | 不把“禁用”和“连接故障”混成统一安全降级 |
| 生产工作流审批 | 有 pending_approval（待审批）、revision_required（待修订）、恢复与局部重跑分支；对应两项单测因测试替身缺方法失败 | 本课程审批实验主入口；先修复测试契约，真实 Redis 重启恢复、并发审批和副作用重放仍以现场证据验收 |
| 评测脚本 | `eval:agent-tasks` 与 `eval:production-workflow` 读取数据文件计算指标 | 脚本通过不代表实际执行 Agent；需标注模拟数据并关联真实运行记录 |

源码入口：[循环](../backend/src/modules/agent-loop/agent-loop.service.ts)、[问答图](../backend/src/rag/agentic/agentic-rag.service.ts)、[生产工作流](../backend/src/modules/workflow/production-workflow.service.ts)、[BM25](../backend/src/rag/karpathy/bm25.util.ts)。

校正纪律：保留问题证据，把相关能力记为待验证或未通过；实施修复后再更新结论。课程不凭讲义声明整条链路已生产验证。
