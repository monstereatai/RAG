# RAG 管理后台前端 - ROADMAP

## 当前阶段：P0-P3 页面全部完成，待联调后端

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

## 进行中

- 无

## 待办

- [ ] E2E 测试
- [ ] 生产构建验证（部署环境）

## 阻塞

- 无

## 最近验证

- 2026-06-24：admin-backend 与 admin 前端联调验证通过
  - 登录接口 `/api/auth/login` 正常返回 JWT token（admin / Admin@123）
  - Dashboard overview / users / roles / menus / config / notifications / account-security 全部 API 正常返回
  - 前端 service 层 API 路径与后端路由完全对齐
  - 前端代理 `/api/` → `localhost:3001` 配置正确
  - CSRF 中间件在 development 模式下跳过
  - 后端 build 通过，缺少 multer 依赖已补装
- 2026-06-24：tsc 零错误 + biome 零 warning，所有类型修复完成
- 2026-06-24：全部页面 UI 截图验证通过，生产构建通过
