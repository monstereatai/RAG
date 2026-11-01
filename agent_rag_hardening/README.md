# Agent/RAG 状态恢复 + 真实 Golden Dataset 评测补强安装包

针对 `monstereatai/RAG` 的 `main` 基线 `6e145bc`。安装前先确认 Git 工作区干净，建议先建立 feature branch。该压缩包包含 `apply_agent_rag_hardening.py`、`new_files/`、`tests/`。安装脚本进行精确源码锚点检查、自动忽略 `.DS_Store`、按路径备份已修改源码。若已有同名但不同内容文件，整体停止而不覆盖。

在仓库根目录解压并执行：

```bash
unzip Agent_RAG_状态恢复与Golden评测_完整补强.zip -d agent_rag_hardening
python3 agent_rag_hardening/apply_agent_rag_hardening.py
pnpm --filter backend build
pnpm --filter backend exec jest --runInBand redis-checkpointer.atomic.spec.ts
pnpm --dir apps/rag-api run test:hardening
```

文档 `docs/AGENT_STATE_RECOVERY_AND_GOLDEN.md` 说明隔离 Redis smoke、PG/Redis/BullMQ 只读审计、真实 Golden Dataset 标注与上线门禁。安装脚本不迁移数据库、不重启服务、不自动触碰生产数据、不提交 Git。

**注意**：真实 Golden Dataset 的人工标注和目标环境故障演练不是软件包能替用户完成的。新 `eval:rag:release` 在缺少此类证据时故意返回失败，避免把合成数据当作生产质量。
