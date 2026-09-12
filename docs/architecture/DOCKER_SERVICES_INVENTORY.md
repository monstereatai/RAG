# Docker 服务清单与整理说明

本仓库涉及的容器、端口、数据卷、命名规范，以及容易踩的冲突点。**整理只做「看得清」和「防止误操作」，没有停止或删除任何服务。**

盘点方式（只读，可随时执行）：

```bash
./scripts/docker-status.sh
```

## 1. 结论速览

本仓库涉及 **3 套相互独立的 compose 栈**，另外机器上还跑着其他项目（knowledge-hub、ai-road、cakecode、fee-docker 等）的容器，**不属于本仓库，不要动**。

| 栈 | compose 文件 | 项目名 | 容器名 | 状态 |
| --- | --- | --- | --- | --- |
| 基础设施 | `docker/docker-compose.yml` | `docker` | `rag-postgres` `rag-redis` `rag-milvus` `rag-milvus-etcd` `rag-milvus-minio` | 5 个运行中（全部 healthy） |
| 监控 | `monitoring/docker-compose.monitoring.yml` | `monitoring` | `rag-prometheus` `rag-grafana` `rag-alertmanager` | 3 个运行中 |
| 管理后台 | `admin-backend/docker/docker-compose.yml` | `admin-backend`（未启动） | `nestjs-enterprise` `mysql-master` … | 未运行 |

另有 dev / staging / prod 三份模板（`docker-compose.dev.yml` / `.staging.yml` / `.prod.yml`），当前只有 dev 的两个容器以退出状态存在。

## 2. 容器命名规范

| 环境 | 前缀 | 例子 |
| --- | --- | --- |
| 基础（本地默认） | `rag-` | `rag-postgres`、`rag-milvus` |
| dev | `rag-dev-` | `rag-dev-postgres`、`rag-dev-es` |
| staging | `rag-staging-` | `rag-staging-backend` |
| prod | `rag-` + 服务名 | `rag-backend`、`rag-frontend` |
| 监控 | `rag-` | `rag-prometheus`、`rag-grafana`、`rag-alertmanager` |
| 管理后台 | 无统一前缀（历史遗留） | `nestjs-enterprise`、`mysql-master`、`rabbitmq` |

后端与管理后台本身**不跑在 Docker 里**（3000 / 3001 是宿主机 node 进程），`rag-backend` 只是 prod compose 里的预留容器名。

## 3. 当前运行容器

| 容器 | 端口（宿主 → 容器） | 健康 | 归属 |
| --- | --- | --- | --- |
| `rag-postgres` | 5432 → 5432 | healthy | 基础设施 |
| `rag-redis` | 6379 → 6379 | healthy | 基础设施 |
| `rag-milvus` | 19530 → 19530、9091 → 9091 | healthy | 基础设施 |
| `rag-milvus-etcd` | 仅内网 2379/2380 | healthy | 基础设施 |
| `rag-milvus-minio` | 9000 / 9001 → 9000 / 9001 | healthy | 基础设施 |
| `rag-prometheus` | 9090 → 9090 | — | 监控 |
| `rag-grafana` | 3030 → 3000 | — | 监控 |
| `rag-alertmanager` | 9093 → 9093 | — | 监控 |

已退出但保留的本仓库容器：`rag-dev-neo4j`、`rag-dev-es`（45 小时前退出，容器与数据卷都还在）。

宿主机进程占用：3000 = RAG 后端（pid 46938）、3001 = 管理后台（pid 38314）。

## 4. 数据卷（数据都在这里）

| 卷前缀 | 含义 |
| --- | --- |
| `docker_postgres_data` `docker_redis_data` `docker_milvus_data` `docker_minio_data` `docker_etcd_data` | 基础栈数据（当前在用） |
| `docker_dev_*`（postgres / redis / etcd / minio / milvus / es / neo4j） | dev 栈数据（dev 容器已退出，数据保留） |
| `monitoring_prometheus-data` `monitoring_grafana-data` `monitoring_alertmanager-data` | 监控栈数据（指标与看板） |
| `docker_backend_workspace` | 后端工作目录卷 |
| `docker_cakecode-*`（6 个） | **历史残留**：cakecode 项目曾在名为 `docker` 的项目名下运行过，卷保留至今，与本仓库无关 |

## 5. 冲突与风险点

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| **两套监控端口撞车** | `admin-backend/docker/docker-compose.yml` 里也有 `prometheus`（9090）与 `grafana`（3000），容器名写死为 `prometheus` / `grafana`，与 `monitoring/` 那套完全冲突，且 grafana 的 3000 还和后端 dev 端口冲突 | 已给这两个服务加 `profiles: ['admin-monitoring']`，**默认不再启动**；需要用它时显式 `--profile admin-monitoring`，并先停掉另一套 |
| **同一目录两份 compose 共享项目名** | `docker/docker-compose.yml` 与 `docker-compose.dev.yml` 服务名完全相同（postgres / redis / etcd / minio / milvus …），仅容器名与卷前缀不同，compose 项目名都取目录名 `docker` | 已在 dev 文件头部写明用法与禁忌；建议一次只启用一份，组合时显式 `-f a.yml -f b.yml` |
| **固定容器名（`container_name`）** | 多个文件都写了 `container_name`，同名容器只能存在一个；两套栈同时 `up` 会直接报名称占用而不是自动错开 | 同上，一次只启用一套 |
| **项目名 `docker` 有歧义** | compose 项目名取自目录名 `docker/`，与 Docker 本身同名，`docker compose ls` 里混着其他项目的卷前缀 | 见第 6 节：改名需迁移，暂未执行 |

## 6. 本次整理做了什么（全部非破坏性）

1. 新增只读盘点脚本 `scripts/docker-status.sh`：容器 / 端口 / 卷 / compose 语法，一次看全。
2. `admin-backend/docker/docker-compose.yml`：给 `prometheus`、`grafana` 加 `profiles: ['admin-monitoring']` 并注明冲突原因 → 默认不会与监控栈抢 9090 / 3000。
3. `docker/docker-compose.dev.yml`：头部补上「与 docker-compose.yml 共享项目名与服务名」的注意事项和推荐调用方式。
4. 产出本清单文档，并在 `docs/README.md` 建立入口。

**没有做任何删除、停止、重命名操作**：没有 `docker rm`、`docker stop`、`docker compose down`、`docker system prune`。

## 7. 待你决定的事项（都需要停机窗口，我没有擅自执行）

1. **给项目改名，消除 `docker` 这个有歧义的项目名**
   在 `docker/` 目录下加 `.env` 写 `COMPOSE_PROJECT_NAME=rag`，或在 compose 里加顶层 `name: rag`。
   影响：改名后现有容器会变成"不属于新项目"的孤儿（会继续运行，但 `docker compose ps` 不再显示它们，再次 `up` 会因 `container_name` 冲突而报错），稳妥做法是**先备份数据卷**，再 `down`（不带 `-v`）+ `up`。
2. **dev 栈是否保留**
   `rag-dev-neo4j`、`rag-dev-es` 已退出 45 小时，对应的 `docker_dev_*` 卷仍占空间。若不再需要，可单独删除容器与卷；我未动。
3. **回收空间（可选）**
   当前：镜像 33.68GB（可回收 14.25GB）、构建缓存 3.12GB、已退出容器 3.81GB、未使用卷 2.48GB；另有 **43 个悬空匿名卷**（多个项目历史运行残留，名字是 64 位哈希）。
   若确实要回收，先确认哪些镜像仍被 prod/staging 引用，再按 `docker image rm <指定镜像>`、`docker builder prune` 逐个处理，**不要用 `docker system prune -a --volumes`**。悬空匿名卷可先用 `docker volume ls -f dangling=true` 逐个人工确认归属再删。
4. **历史残留卷 `docker_cakecode-*`**
   与本仓库无关，确认 cakecode 项目不需要后再单独清理。

## 8. 安全操作约定

- 停服务只用 `docker stop <容器名>`，不用 `docker compose down`（后者可能连带 orphan 容器）
- **绝对不用** `docker compose down -v`（删数据卷）、`docker system prune` / `prune -a --volumes`（删镜像与卷）、`docker volume rm`（除非确认已备份）
- 清理前先 `./scripts/docker-status.sh` 看清楚，再按精确名字操作
- 监控栈的过渡期说明见 `docs/architecture/MONITORING_PROMETHEUS_GRAFANA.md`（重启后端后要切回正式抓取配置）
