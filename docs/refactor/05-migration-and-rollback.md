# 兼容迁移与回退边界

本次不做数据库 Schema/数据迁移，旧 DTO、Service Facade 和 import 路径保留。先迁移共享类型/纯策略，再在 Nest 模块注入并替换消费者。每阶段跑相关验证后再推进依赖阶段。

Document 索引是派生状态，保留原有上传失败清理顺序、Milvus 删除补偿持久化和版本激活投影；不得把多索引写入描述成跨系统事务。Checkpoint 不担保外部工具 exactly-once。

未执行 Git 回滚或文件删除。需要回退代码、修改配置/密钥/CI、Schema/迁移、全局依赖或发布时，按 CLAUDE.md 单独取得明确授权。当前已有未提交工作不得 reset/clean/stash。
