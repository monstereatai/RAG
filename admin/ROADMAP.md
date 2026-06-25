# RAG 管理后台前端 - ROADMAP

## 当前阶段：后台管理端效果图对齐与工程验证完成；`/graph-ops` 三个二级菜单已实现并完成接口联调

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

## 进行中

- [ ] `/graph-ops` 三个二级菜单浏览器截图复验：当前已完成路径 200 和接口联调，尚未做 Puppeteer/Playwright 视觉截图。

## 待办

- [ ] E2E 测试
- [x] 生产构建验证（本地 `max build` 已通过；部署环境仍需在正式 Node 22+ 环境复验）

## 阻塞

- 当前 shell Node.js 为 v20.18.0，项目 package.json 要求 >=22.0.0；`pnpm run lint`、`pnpm run test`、`pnpm run build` 均可通过但会提示 engine warning，建议切到 Node 22+ 后做最终复验。
- `pnpm exec antd lint ./src` 在 Node 20 下会触发 `oxc-parser` 的 CJS/ESM 加载错误；使用 Node 24 执行同一 antd CLI 已通过。
- 2026-06-25：`pnpm run build` 本轮被现有 `utoo pack dev` 进程持有的 `.turbopack/lock` 阻塞；未停止主人正在运行的 8000 dev server。
- 真实 Neo4j 图谱当前为空时，`/graph-ops` 页面会展示 `meta.demo=true` 的演示数据提示，不把演示数据当真实数据。

## 最近验证

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
  - 根目录 `AGUI_INTEGRATION.md` 已补齐管理后台流式问答启动和验证说明
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
