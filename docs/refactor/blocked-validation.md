# 尚未执行的验证

截至 P0，以下为 NOT RUN，环境是否可用将在 P6 检查：

- 管理后台 simple/auto/agentic 三种模式真实问答，需现存可用服务、登录态和模型配置。
- PostgreSQL/Redis/Milvus/ES/Neo4j 联调、Worker 重启及故障注入；不得操作用户真实数据来模拟故障。
- 私有业务黄金集、生产 IAM、p50/p95/token/成本 A/B；需要真实业务数据和受控环境，Mock 不能代替。
- 无真实凭据时不创建或修改 .env，不伪造通过记录。

具体环境检查结果和阻塞原因在后续追加。

## 2026-10-29 实际检查

- `docker compose -f docker/docker-compose.yml ps --format json`：FAIL，Cannot connect to Docker daemon at `unix:///Users/monster/.docker/run/docker.sock`。
- 禁用 HTTP proxy 后直连 `127.0.0.1` 的 3000/3001/3002 health、5173/5174 页面：全部 Connection refused。最初经系统 proxy 的 502 不作为服务自身错误归因。
- 因此 backend start/健康、真实 PostgreSQL/Redis/ES/Milvus/Neo4j、后台三模式 UI 均 BLOCKED。没有启动服务来触发未知数据库自动同步，没有改 .env 或创建账号。
- Golden/质量/性能/故障评测 NOT RUN。主人后续要求“测试不是很重要，先实现功能先”，本轮优先完成代码，不扩大测试或上传/删除测试文档。
- 全量 Jest 已运行：113 suites 中 106 PASS、7 FAIL，590 tests 中 570 PASS、20 FAIL；失败集中在本轮未改动的 rag-admin、team-wiki、feishu、conversation-embedding、domain-events 模块，见 `evidence/full-jest.txt`。
- 历史有效期查询：已按“查询时段与文档有效期相交”实现，草稿/归档继续排除，普通查询按当前时间；真实 ES/Milvus/PostgreSQL 数据链路和授权旧版本回放仍需可用的本地或受控环境验证。
- 真实生产 IAM、业务黄金集与容量压力环境未提供，不能给出准确率提升、p95 改善或完整生产隔离结论。
