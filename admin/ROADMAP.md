# RAG 管理后台前端 - ROADMAP

## 当前阶段：核心功能与生产构建完成；等待登录后 E2E、Graph Ops 视觉复验和生产环境验收

## 技术栈

- **框架**：Ant Design Pro（基于 Umi Max v4）
- **UI 组件**：antd v6 + ProComponents v3
- **图表**：@ant-design/plots（趋势图）
- **图谱可视化**：D3.js（力导向图）
- **语言**：TypeScript
- **构建**：Umi 4 (utoo pack)
- **样式**：antd-style (CSS-in-JS)
- **测试**：Vitest
- **包管理**：pnpm

## 已完成

### Phase 1: 核心配置改造
- [x] 基于 Ant Design Pro 官方模板克隆
- [x] 替换路由配置（config/routes.ts）为 RAG 管理后台路由
- [x] 更新代理配置（config/proxy.ts）指向 admin-backend (localhost:3001)
- [x] 更新默认设置（config/defaultSettings.ts）标题、布局
- [x] 改造 app.tsx 认证流程（JWT Token + localStorage）
- [x] 改造 access.ts 权限控制（RBAC）
- [x] 改造登录页（对接 /api/auth/login）
- [x] 更新中文菜单国际化
- [x] 清理 demo 页面和旧 services

### Phase 2-P0: 核心业务页面
- [x] 首页大盘（统计卡片 + 趋势图 + 响应性能指标）
- [x] 文档治理（ProTable + 状态筛选 + 重新处理/删除）
- [x] 文档详情页（元数据展示 + 分块预览）
- [x] 用户管理（CRUD + 角色分配 + 重置密码）
- [x] 角色管理（CRUD + 权限分配）
- [x] 权限管理（CRUD + 模块分组）

### Phase 3-P1: 运营页面
- [x] 搜索运营（统计卡片 + 搜索记录 ProTable）
- [x] 问答运营（统计卡片 + 问答记录 ProTable + 置信度/反馈）
- [x] 图谱运营（统计卡片 + 实体类型分布 + D3 力导向图可视化 + 节点搜索表格）

### Phase 4-P2: 辅助功能页面
- [x] 通知中心（ProList + 标记已读/删除）
- [x] 系统配置（服务配置分组表单）
- [x] 审计日志（ProTable + 操作/资源筛选）
- [x] 系统管理-配置（基础配置表单）
- [x] 系统管理-日志（系统日志表格）

### Phase 5-P3: 扩展页面
- [x] 账号安全（密码修改 + 两步验证 + 登录历史）
- [x] 菜单管理（树形表格 + CRUD）
- [x] 个人中心（搜索历史/问答历史/操作记录）
- [x] 个人设置（基本设置 + 安全设置 + API 配置 + 消息通知）

### Phase 6: 数据可视化
- [x] 首页趋势图（@ant-design/plots Line 图，7/14/30 天切换，mock 数据降级）
- [x] 知识图谱可视化（D3 力导向图，拖拽/缩放/节点搜索）

### Phase 7: admin-picture 效果图对齐
- [x] 新增统一后台 Shell（顶部一级导航 + 左侧模块二级导航 + 统一内容容器）
- [x] 登录页重做为效果图风格的左右分屏登录体验
- [x] 首页大盘重做为指标卡、访问趋势、分类环图、近期操作记录布局
- [x] 文档管理重做为工具栏、视图切换、文件图标、解析状态与权限表格布局
- [x] 智能搜索重做为搜索栏、筛选区、结果卡片与关键词高亮布局
- [x] AI 问答重做为会话列表、问答详情、引用文档、追问建议与输入区布局
- [x] 知识图谱重做为筛选栏、D3 图谱画布、图例控件、统计与热门知识点侧栏布局
- [x] 个人中心重做为个人资料、密码修改、登录记录、权限查询布局
- [x] 系统用户管理重做为批量操作、筛选栏、用户表格与分页布局
- [x] AI 问答页面接入 AG-UI 流式协议：`/api/admin/qa-ops/agui/stream` → admin-backend → rag-backend，支持 agentic/auto/simple 模式、事件轨迹、引用、路由、检索充分性、置信度与错误态
- [x] AI 问答岗位预设：从 RAG 服务代理八个岗位目录，展示职责、常用任务和示例问题，本地记忆岗位选择并在 AG-UI 请求中透传 `rolePresetId`；与系统 RBAC 角色保持分离
- [x] AI 问答产物中心：从当前输入或最近回答生成 Markdown、Word、Excel、SVG 架构图和 PNG，支持任务状态轮询、下载、内部／外部分享
- [x] AI 问答直接生成附件：对话请求明确文件类型时，解析 AG-UI `output.artifacts`，在回答卡片内轮询状态并提供下载、分享按钮
- [x] 外部分享页：`/shared/artifacts/:token` 无需登录，展示文件信息、有效期、下载次数并预览 PNG／SVG；390px 移动端无横向溢出
- [x] Agent 运营工作台：`/agent-ops` 支持产研运工作流启动与人工审批、Agent 单案例评测、Bad Case 审核回灌和调用轨迹查询
- [x] Agent 运营菜单补齐：Agent Evals 和调用轨迹新增独立路由及左侧菜单入口，仍复用原有评测和 Trace 接口
- [x] Agent 运营移动端：390px 下隐藏冗长品牌文字，表单、页签、按钮无横向溢出

### 工程验证
- [x] pnpm install 成功
- [x] 项目可启动（localhost:8000）
- [x] 登录页 UI 正常渲染
- [x] 生产构建通过（max build）
- [x] Puppeteer 截图验证（登录页/首页大盘/文档治理/个人中心/个人设置/图谱运营）

### TypeScript 类型修复
- [x] 修复 useApp() 类型问题 — 全部改用 antd 静态 message/Modal.confirm，绕过 TS6+antd6 交互 bug
- [x] 修复 React.useRef 泛型调用问题 — 显式传递 undefined 初始值
- [x] 修复 ProFormPassword 导入错误 — 改用 ProFormText.Password
- [x] 修复 dayjs fromNow 缺失 — 导入 relativeTime 插件
- [x] 补充 API.CurrentUser 类型声明
- [x] 修复 tsconfig include/exclude 范围
- [x] 清理未使用的导入和变量（biome --unsafe 修复）
- [x] 删除无效测试文件（引用不存在的 queryProvince/queryCity）
- [x] 删除调试文件（_debug_*.ts）
- [x] tsc 零错误（排除 .umi 生成代码）
- [x] biome 零 warning

### Phase 8: 工程验证链路修复
- [x] 修复 `pnpm run lint` 被 Umi 生成目录 `.umi` TS2883 错误阻塞的问题
- [x] 移除运行时代码对 `@@/plugin-request/request` 生成类型的依赖
- [x] 将 Vitest 调整到兼容 Umi 4 / Vite 4 的 0.34.6 版本
- [x] 对齐 RBAC 权限测试与请求错误提示测试断言
- [x] 补齐 antd CLI 在 macOS arm64 下需要的 oxc parser 可选原生绑定
- [x] `/graph-ops` 三个二级菜单实现：`节点管理`、`关系检索`、`图谱统计`，包含子路由、筛选栏、表格、详情抽屉、局部图谱、统计分布和 demo 状态提示。
- [x] 修复本地 admin 启动后 JS 资源返回 HTML 的问题：新增 `config/config.local.ts`，development 模式禁用异常的 Utoo dev server，回退到 webpack dev server。
- [x] 优化顶部消息入口：铃铛未读数改为读取通知接口，点击展示最近消息、刷新、全部已读、单条标记已读和跳转通知中心。

## 进行中

- [ ] `/graph-ops` 三个二级菜单浏览器截图复验：当前已完成路径 200 和接口联调，尚未做 Puppeteer/Playwright 视觉截图。
- [ ] `/agent-ops` 登录后浏览器复验：当前无登录态访问会正确跳转登录页且控制台无错误，尚未复验工作流轮询、审批、局部重跑和产物交互。

## 待办

- [ ] Admin E2E：覆盖登录、Agent 工作流、QA 产物、外部分享和 Graph Ops 关键路径
- [x] 生产构建验证（本地 `max build` 已通过；部署环境仍需在正式 Node 22+ 环境复验）

## 阻塞

- 默认 shell 仍可能是 Node.js v20.18.0；项目要求 >=22.0.0。本轮已使用 Node v22.22.1 完成 backend 全量测试，admin 仍需在正式部署环境固定 Node 22+。
- `pnpm exec antd lint ./src` 在 Node 20 下会触发 `oxc-parser` 的 CJS/ESM 加载错误；使用 Node 24 执行同一 antd CLI 已通过。
- 2026-07-07：Utoo dev server 在本机出现 `.turbopack/lock` 残留与 JS 路径 fallback 到 HTML 的问题；已用 development-only `config/config.local.ts` 回退 webpack，后续如要重新启用 Utoo 需先确认 Utoo/Node 版本兼容性。
- 真实 Neo4j 图谱当前为空时，`/graph-ops` 页面会展示 `meta.demo=true` 的演示数据提示，不把演示数据当真实数据。

## 最近验证

- 2026-09-13：顶部消息入口优化
  - `AdminShell` 复用现有 `/api/admin/notifications` 与标记已读接口，移除硬编码未读数。
  - 新增消息浮层、最近 6 条消息、未读状态、类型标签、刷新和「全部已读」操作。
  - 定向 Biome：`pnpm exec biome lint src/components/AdminShell/index.tsx src/components/AdminShell/style.less` 通过。
  - antd 专项扫描确认本次文件无新增 issue；全项目仍保留既有 25 个 deprecated 提示。
  - 全项目 `pnpm exec tsc --noEmit` 仍被既有 React 类型重复、workflow-detail 字段和历史页面类型问题阻断，未指向本次改动文件。

- 2026-08-03：Agent 运营工作台闭环
  - admin-backend Agent Ops 代理接口支持工作流、评测、坏例和 trace，8 Suites／71 Tests 与 build 通过
  - admin `/agent-ops` 真实加载 1 条已审核 Bad Case，单案例评测显示“评测通过”，调用轨迹表可分页查看
  - 桌面 1440px 和移动 390px 均无横向溢出，移动端品牌栏已收敛
  - 补齐 `menu.agent-ops` 中文文案并替换弃用的 `Alert.message`，生产 build 通过
  - 当前 shell Node 20 仍有 package engine 警告，运行中的 admin dev server 使用 Node 22

- 2026-08-03：QA 对话直接生成 Word 回归修复
  - 意图解析和 AG-UI 自动附件单测 2 Suites／13 Tests 通过
  - admin 生产构建通过
  - 真实 Qwen SSE 返回 `artifact_generate` 工具事件且无“无法生成／复制粘贴”拒绝文案
  - Word 任务最终 ready，下载 DOCX 10804 bytes，ZIP 文件头和 MIME 均有效

- 2026-08-03：QA 产物与分享闭环
  - admin TypeScript 与 `pnpm exec antd lint ./src` 通过，本次页面 0 新增 issue
  - admin-backend build 通过，相关测试 2 Suites／37 Tests 通过
  - 浏览器验证生成按钮、生成弹窗、文件入口和外部匿名分享页
  - 桌面与 390px 移动端分享页无横向溢出，真实 DashScope 图片预览正常

- 2026-08-03：管理后台岗位预设闭环
  - `GET /api/admin/qa-ops/role-presets` 真实返回 8 个岗位，默认业务负责人
  - 产品经理 `rolePresetId` 经 admin-backend AG-UI 代理进入 RAG `RUN_STARTED` 输入，流返回 200 且包含 `RUN_FINISHED`
  - admin-backend：8 Suites／71 Tests、build、lint 通过（lint 仅 3 个既有 warning）
  - admin：定向 Biome、TypeScript、生产 build 通过；Ant Design CLI 扫描 154 files，本次新增页面 0 issue（全项目保留 10 个既有 deprecated 提示）
  - backend：Node 22 下 28 Suites／135 Tests、build 通过
  - 浏览器验证岗位目录、职责、任务和示例问题正常显示，页面与聊天区无横向溢出

- 2026-07-07：admin 本地启动修复
  - 新增 `config/config.local.ts`，仅 development 读取，覆盖 `utoopack: false`
  - 使用 Node v22.22.1 + 本地 `max setup` 生成 Umi 临时文件
  - `http://localhost:8000/umi.js` 返回 `Content-Type: application/javascript`，正文为 webpack bootstrap，不再返回 HTML
  - `http://localhost:8000/` 返回 200，admin 前端恢复可访问
- 2026-06-25：`/graph-ops` 三个二级菜单实现与联调完成
  - 新增路径：`/graph-ops/nodes`、`/graph-ops/relations`、`/graph-ops/stats`
  - 页面完成：节点管理表格与详情抽屉、关系检索表格与局部图谱、图谱统计指标与类型分布
  - service 完成：`getGraphNodeDetail`、`getGraphRelations`、`searchGraphRelations`，并补齐 `meta.demo/available/source`
  - 验证通过：`pnpm run lint`
  - 路径验证：`http://localhost:8000/graph-ops/nodes`、`/relations`、`/stats` 均返回 200 HTML
  - 未完成：`pnpm run build` 被现有 8000 dev server 的 `.turbopack/lock` 阻塞；未做浏览器截图复验
- 2026-06-25：`/graph-ops` 三个二级菜单实施计划完成
  - 新增 `admin/docs/graph-ops-menu-implementation-plan.md`
  - 明确节点管理、关系检索、图谱统计 UI 草图、接口契约、编码 checklist、红线与验收标准
  - 本次未编码，未运行前端构建验证
- 2026-06-24：工程验证链路复验
  - `pnpm run lint` 通过（biome + `tsc --noEmit`）
  - `pnpm run test` 通过（3 files / 25 tests）
  - `pnpm run build` 通过，产物输出到 `dist`
  - antd 专项检查通过：使用 Node 24 执行 `@ant-design/cli lint ./src`，扫描 153 files，No issues found
  - 已知环境提示：当前 shell Node v20.18.0 低于项目要求的 Node >=22.0.0
- 2026-06-24：AG-UI 流式问答接入验证
  - `pnpm run lint` 通过（biome + `tsc --noEmit`）
  - `pnpm exec tsc --noEmit` 通过
  - `pnpm exec biome lint src/pages/qa-ops src/global.less` 通过
  - `pnpm run build` 通过，产物输出到 `dist`
  - `pnpm run start:no-mock` 启动成功，`http://localhost:8000/` 与 `http://localhost:8000/qa-ops` 均返回 200
  - 后台 AG-UI SSE 链路已由 admin-backend 真实代理验证通过
- 2026-06-24：AG-UI 文档与工程规则同步
  - `CLAUDE.md` 已从模板默认 npm/package-lock 规则同步为当前实际 `pnpm + pnpm-lock.yaml`
  - `docs/product/AGUI_INTEGRATION.md` 已补齐管理后台流式问答启动和验证说明
  - `pnpm run lint` 通过
- 2026-06-24：admin-picture 效果图对齐复验
  - `pnpm run build` 通过，产物输出到 `dist`
  - 业务源码 TypeScript 检查通过（排除 `src/.umi/**`、`src/.umi-production/**`、`src/.umi-test/**` 生成目录）
  - `pnpm run lint`：历史上曾被 `src/.umi/core/history.ts` 与 `src/.umi/plugin-access/index.tsx` 的 TS2883 生成代码错误阻塞，现已修复
  - 本地预览 `http://localhost:8000` 使用 `admin / Admin@123` 登录成功
  - 浏览器截图验证：Dashboard、Documents、QA、Graph、Account Center、System Users 页面无控制台错误；QA 输入区未裁切，Graph 画布未被右侧卡片撑高
  - 最新验证截图目录：`/tmp/rag-admin-ui-final-browser-2`
- 2026-06-24：admin-backend 与 admin 前端联调验证通过
  - 登录接口 `/api/auth/login` 正常返回 JWT token（admin / Admin@123）
  - Dashboard overview / users / roles / menus / config / notifications / account-security 全部 API 正常返回
  - 前端 service 层 API 路径与后端路由完全对齐
  - 前端代理 `/api/` → `localhost:3001` 配置正确
  - CSRF 中间件在 development 模式下跳过
  - 后端 build 通过，缺少 multer 依赖已补装
- 2026-06-24：tsc 零错误 + biome 零 warning，所有类型修复完成
- 2026-06-24：全部页面 UI 截图验证通过，生产构建通过
