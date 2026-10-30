# 产研工作流多形态产物计划

> 状态：进行中。本地多形态生成、代码修改、预览、版本和模拟同步已实现；OpenSandbox 项目工作区代码已接入，真实 Server/Runtime 与低代码平台契约待提供后联调。

## 目标

让用户可以从同一份活动需求生成 JSON Schema、Vue/React 页面代码或数字大屏代码；在预览中用自然语言修改；确认后下载产物，或一键同步 Schema 到低代码平台。后续为 Agent 提供隔离的项目工作区，支持按需安装依赖、运行测试和启动开发服务。

## 当前基础与缺口

- 产研工作流可从已审批岗位的 `lowCodeSchemas` 汇总内部活动页 Schema，也可生成独立 Dashboard Schema。
- 单次任务可多选活动页 Schema、Vue/React 页面、Dashboard Schema、Vue/React 大屏项目；代码项目可下载为 ZIP。
- 自然语言修改先生成经过结构校验的 Schema 候选和字段差异；确认应用后创建新版本，并可选择重新生成对应 Vue/React 项目。
- JSON Schema 有查看/下载、版本历史和恢复入口。Vue/React 页面与大屏由固定模板生成；生成代码可用自然语言直接修改，候选源码会编译预览。
- 生成源码由独立 preview-runner 编译；容器不加入业务数据网络、不接收业务凭据，前端通过受限 sandbox iframe 显示预览。
- 大屏支持指标卡和柱状趋势组件；未配置数据源时标记为未配置，mock 示例明确标记为模拟数据。
- 低代码同步目前只记录稳定模拟对象 ID、用户和审计记录，不调用真实平台。活动页 Schema 仍是内部结构，不能视为平台可导入格式。
- 项目组件编号来自现有清单，尚未确认是否为低代码平台真实内部编号。现有活动图谱同步写入 Neo4j，不等于低代码平台同步。

当前缺口：真实平台 API 和数据凭据未接入；直接编辑代码只覆盖固定页面组件和样式文件，不能改依赖/构建配置，也不会反向映射回 Schema；OpenSandbox 适配层和管理端操作已落地，但未连接或验收目标 Server/Runtime；大屏没有连接真实数据源。

相关入口：`apps/rag-api/src/modules/workflow/production-artifact-studio.service.ts`、`apps/rag-api/src/modules/artifacts/artifacts.service.ts`、`apps/preview-runner/`、`apps/admin-web/src/pages/agent-ops/workflow-detail/index.tsx`。

## 建议的产物关系

- 活动页面以一个有版本的活动 Schema 作为可同步的主产物；Vue 和 React 项目可从该 Schema 生成。
- 数字大屏使用独立的 Dashboard Schema，描述布局、图表、筛选项和数据绑定，再由选定的 Vue/React 模板生成代码。
- 自然语言默认修改对应 Schema，并据此刷新预览和重新生成代码。若用户直接修改代码，只有能映射回 Schema 的内容才允许同步低代码平台；不能映射时明确标出差异。
- 对已生成的 Vue/React/大屏代码也提供独立自然语言修改：仅修改允许的应用源码/样式文件，先展示文件差异并编译预览，确认后创建新的 ZIP 代码版本；这类源码改动不自动改 Schema。
- Schema 和代码均保存版本及变更差异，支持查看历史和恢复旧版本。
- 固定模板的快速预览继续使用 `preview-runner`；Agent 需要安装依赖、运行测试或启动任意开发服务时，使用独立的 OpenSandbox 项目工作区。两者隔离边界、生命周期和浏览器访问方式不同，不把任意 Shell 执行加进 `preview-runner`。

## 实施阶段

### P0：确认平台与交付契约

- [ ] 获取低代码平台的真实 Schema 示例、组件 ID、创建/更新草稿接口、认证方式和错误格式。
- [ ] 确认按钮同步后是创建草稿还是更新已有页面；正式发布继续由平台自身发布流程控制。
- [ ] 确认数字大屏的数据源、图表组件、刷新方式和 mock 数据约定。
- [x] 确认一个需求可同时选择多种产物：允许多选。

### P1：Schema 作为主产物

- [x] 定义内部活动页与大屏 Schema 的字段、版本和结构校验；真实平台组件映射待 P0 确认。
- [x] 提供 Schema 查看与 JSON 下载。
- [x] 增加自然语言修改入口：模型返回受约束的 Schema 候选，后端校验后展示修改差异；用户应用后生成新版本。
- [x] 从已审批活动页组件生成页面预览和代码视图。

### P2：低代码同步

- [x] 增加明确标为模拟的同步操作，记录稳定模拟对象 ID、操作用户、版本哈希和审计历史。
- [ ] 接入真实平台 API 和服务端授权信息；平台 Schema、组件映射、错误格式及测试环境由用户后续提供。
- [ ] 真实同步前校验平台 Schema 和组件映射；成功后记录平台对象 ID、版本和返回链接，失败时保留本地版本并显示原因。
- [ ] 真实同步只创建或更新平台草稿，不自动触发正式发布。

### P3：Vue / React 代码生成与预览

- [x] 提供固定 Vue/React 页面模板，明确仅支持当前 Schema 映射的组件和静态数据。
- [x] 从 Schema 生成源码文件清单和 ZIP；修改 Schema 后可重新生成并保存新版本。
- [x] 在隔离 preview-runner 容器中编译生成代码；限制网络、CPU、内存、临时空间、源码体积和编译时长。
- [x] 将自包含预览放入受限 sandbox iframe；编译失败返回错误信息，可修改 Schema 后重新生成预览。
- [x] 对已生成代码提供自然语言直接修改：限定可编辑文件，不接受依赖/构建配置变更；应用前展示文件差异并编译预览，确认后保存为新 ZIP 版本。

### P4：数字大屏生成

- [x] 定义独立 Dashboard Schema，覆盖布局、指标卡、柱状趋势和未配置/mock 数据模式。
- [x] 生成 Vue 或 React 大屏代码，并在同一隔离预览环境中编译预览。
- [x] 自然语言修改 Dashboard Schema 后可更新预览和代码；模拟数据有显式标记，默认不编造指标值。
- [ ] 真实数据源接入需单独授权和验收；平台支持大屏 Schema 时再按正式契约增加同步。

### P5：Agent 项目开发工作区（OpenSandbox；代码已接入，目标环境验收待完成）

- [x] 以 `tenantId（若身份链路提供）+ userId + threadId` 隔离工作区；同一 Artifact 重连保留修改，不同 Artifact 要求先导出并显式销毁；Redis NX 锁避免同一身份并发创建重复沙箱。
- [x] Agent 通过受审计、带幂等保护的工作区工具执行命令，可安装项目依赖、运行测试、读写项目文件，并启动/停止开发服务器；命令最多 240 秒、输出最多 16 KiB，沙箱最多 2 CPU/4 GiB 与 6 小时绝对寿命。
- [x] 网络出口默认拒绝，配置默认只放行 npm、npmmirror 和阿里云镜像域名；不挂载宿主目录、不传入 RAG/数据库/对象存储/模型凭据、不挂 Docker Socket。
- [x] 开发服务启动后做进程状态与端口探测；预览使用绑定 owner/thread/port 的 5 分钟票据，通过 Admin 代理访问，仅允许 GET/HEAD、禁止重定向，HTML/SVG/XML 强制 CSP sandbox。
- [x] Redis 保存 workspace locator 与绝对到期时间；同 Artifact 重连，切换 Artifact 前明确导出/销毁；销毁要求二次确认。
- [x] 导出时过滤 `node_modules`、`.git` 与 symlink，设置文件/解压体积限制，并保存到现有 Artifact 版本/下载流程；不自动部署。
- [x] 逐文件核对 `preview-runner`，并把 `ai-infrastructure` 的 Sandbox 生命周期、Backend 注入、部署、运行配置和隔离集成验收映射写入本节与下方表格；固定模板预览仍由 preview-runner 负责。
- [ ] 在真实目标环境验证 OpenSandbox Server 与 SDK 兼容性、真实 tenant 身份传递、网络出口规则、资源回收、不同租户隔离和预览访问。
- [ ] 在 OpenSandbox Server/Runtime 配置并验证磁盘配额、PID 上限等底层限制；当前 RAG SDK 适配层只设置 CPU、内存、网络策略和最大寿命。
- [ ] 预览代理不支持 WebSocket，Vite HMR 不可用；如需热更新，需单独设计安全的 WebSocket 代理与取消流程。

## 验收条件

- [x] 用户能多选目标产物并查看生成的 Schema 或源码。
- [x] Schema 修改有结构校验、差异预览、版本记录和恢复能力。
- [x] 用户能直接用自然语言修改生成代码，先查看源码差异和编译预览，再保存为新代码版本；Schema 与代码的不同步状态需明确显示。
- [x] Vue、React 和大屏项目能在隔离 runner 中构建并预览；runner 不与业务数据网络互通。
- [x] JSON/ZIP 下载绑定当前版本。
- [x] 真实平台接口未就绪时，按钮明确显示模拟模式，不以 Neo4j 图谱同步或本地预览冒充平台验收。
- [ ] 真实平台同步通过正式 Schema 契约、目标环境验收后，再完成平台对象可追踪和真实 API 幂等验收。
- [ ] Agent 能在独立项目工作区安装依赖、运行测试并启动开发服务；代码 mock 验证已通过，但真实目标环境的租户隔离、磁盘/PID 限额、超时回收、授权预览和 ZIP 导出仍需实机验收。

## 待确认与边界

- **待确认**：低代码平台名称、接口文档、鉴权方式、真实组件 ID、Schema 样例和目标测试环境。
- **待确认**：数字大屏是否需要连接真实数据源，以及可用图表组件和刷新频率。
- **已确认**：一次任务允许多选产物。
- **边界**：直接源码编辑不会反向更新 Schema；若要把源码改动同步到低代码平台，需要另行定义源码与平台 Schema 的映射规则。
- **边界**：OpenSandbox 目标能力是 Agent 项目开发与运行，不替代固定预览编译器；接入服务地址、API Key、镜像、网络和持久卷前，需按项目红线单独确认配置和环境变更。
- **参考实现**：[`ai-infrastructure/src/deal_pilot/utils/sandbox.py`](../../ai-infrastructure/src/deal_pilot/utils/sandbox.py)（创建/重连/续期和并发锁）、[`ai-infrastructure/src/deal_pilot/backends/sandbox_backend.py`](../../ai-infrastructure/src/deal_pilot/backends/sandbox_backend.py)（Agent 命令与文件接口）、[`ai-infrastructure/src/deal_pilot/agents/agent_factory.py`](../../ai-infrastructure/src/deal_pilot/agents/agent_factory.py)（Backend 注入 Agent）、[`ai-infrastructure/opensandbox_config.toml`](../../ai-infrastructure/opensandbox_config.toml) 与 [`ai-infrastructure/docker-compose.yml`](../../ai-infrastructure/docker-compose.yml)（OpenSandbox Server 和运行配置）、[`ai-infrastructure/docker/sandbox/Dockerfile`](../../ai-infrastructure/docker/sandbox/Dockerfile)（自定义执行镜像）、[`ai-infrastructure/src/deal_pilot/tools/deploy.py`](../../ai-infrastructure/src/deal_pilot/tools/deploy.py) 和 [`ai-infrastructure/tests/intergrations/test_deploy.py`](../../ai-infrastructure/tests/intergrations/test_deploy.py)（产物部署及隔离验收）。SDK 接口以 [OpenSandbox JavaScript/TypeScript SDK 文档](https://open-sandbox.ai/sdks/javascript) 为准；服务生命周期、命令、文件、端口、网络出口与资源限制按部署版 Server 支持范围适配。

### preview-runner 逐文件对照

以下对照用于决定复用边界；OpenSandbox 是通用 Agent 项目执行环境，preview-runner 是固定 Vue/React 项目的编译预览服务，不把前者实现直接复制进后者。

| preview-runner 文件 | ai-infrastructure 对照 | 可参考内容与边界 |
|---|---|---|
| `apps/preview-runner/README.md` | `课件/18. 开源沙箱方案.md`、`课件/23. Agent接入沙箱后端.md` | 参考隔离层级、工作目录、持久化与清理说明；两者功能边界不同。 |
| `apps/preview-runner/package.json` | `docker/sandbox/Dockerfile`、`pyproject.toml` | 没有等价的 Node 编译服务；只参考在镜像内固定可用运行时/工具的做法。 |
| `apps/preview-runner/package-lock.json` | `uv.lock` | 依赖锁定原则相同，包生态不同，不复用锁文件或依赖版本。 |
| `apps/preview-runner/Dockerfile` | `docker/sandbox/Dockerfile`、`课件/19. 自定义沙箱镜像.md` | 参考可复现镜像和预装依赖；Agent 执行镜像包含更多开发工具，不复制到轻量编译器。 |
| `apps/preview-runner/src/server.mjs` | `src/deal_pilot/backends/sandbox_backend.py`、`src/deal_pilot/utils/sandbox.py` | 前者接收单次编译请求并启动短时进程；后者负责 OpenSandbox 创建/重连及命令/文件操作。复用工作区的生命周期思路，不替换 HTTP 编译 API。 |
| `apps/preview-runner/src/build-preview.mjs` | `src/deal_pilot/tools/deploy.py`、`docker/sandbox/Dockerfile` | 没有 Vue/React 编译器等价实现。现有 Vite 固定配置保留；任意安装依赖、测试、启动服务放到独立 OpenSandbox 工作区。 |
| `apps/preview-runner/src/contracts.mjs` | `opensandbox_config.toml`、`src/deal_pilot/tools/deploy.py` | 前者校验源码文件/导入/体积并生成 CSP；后两者配置沙箱权限和校验用户/路径。参考“执行前校验”，不能互换其安全控制。 |
| `apps/preview-runner/src/contracts.spec.mjs` | `tests/intergrations/test_deploy.py`、`tests/intergrations/deploy_support.py` | 参考路径越界、多用户隔离、失败不上传等验收场景；preview-runner 仍以本地源码校验和编译测试为主，真实沙箱测试需单独启用。 |

补充：`课件/21. 创建和复用沙箱.ipynb`、`课件/22. 实现沙箱后端.ipynb` 展示 SDK 操作；`课件/26. 沙箱直传MinIO.ipynb` 可参考沙箱产物回传模式，但本项目 ZIP 沿用 RAG 现有 Artifact 版本和下载流程，不直接接入 MinIO；`课件/27. 沙箱产物自动部署.md` 当前只有占位，实际部署实现以 `tools/deploy.py` 为准；`课件/28. 沙箱共享卷.md` 面向 Skills/共享文件，只读共享卷不作为用户项目工作区方案。
- 本计划不包含自动正式发布到线上。
- 若实施需要新增数据库 Schema、密钥配置、依赖或生产环境变更，按根目录 `CLAUDE.md` 的审批边界单独处理。
