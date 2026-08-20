# 管理后台前端功能表

> 基于 admin-backend 已实现的后端 API，梳理前端功能模块清单。

## 功能模块概览

| 模块 | 路由前缀 | 状态 | 说明 |
|------|---------|------|------|
| 登录认证 | `/auth` | ✅ 可用 | JWT 登录、Token 刷新 |
| 用户管理 | `/users` | ✅ 可用 | 用户 CRUD、角色分配 |
| 角色管理 | `/admin/roles` | ✅ 可用 | 角色 CRUD、权限分配 |
| 权限管理 | `/admin/permissions` | ✅ 可用 | 权限 CRUD |
| 首页大盘 | `/admin/dashboard` | ✅ 可用 | 系统概览、趋势图表 |
| 文档治理 | `/admin/documents` | ✅ 可用 | 文档列表、下载、删除 |
| 智能搜索运营 | `/admin/search-ops` | ✅ 可用 | 热门查询、无结果查询、召回问题 |
| AI 问答运营 | `/admin/qa-ops` | ✅ 可用 | 负反馈、引用失败、成本统计 |
| 知识图谱运营 | `/admin/graph-ops` | ✅ 可用 | Schema、实体、关系、孤立节点、图谱可视化 |
| 通知中心 | `/admin/notifications` | ✅ 可用 | 通知列表、标记已读 |
| 系统配置 | `/admin/system-config` | ✅ 可用 | 模块状态、环境变量、密钥管理 |
| 审计日志 | `/admin/audit-logs` | ⚠️ 部分 | 需数据库持久化 |
| 账号安全 | `/admin/account-security` | ⚠️ 部分 | 登录失败锁定可用，MFA 需外部通道 |
| 菜单管理 | `/admin/menus` | ⚠️ 部分 | 静态菜单树可用，持久化需 schema |
| 系统管理 | `/admin/system` | ✅ 可用 | 用户管理、角色权限、系统配置、日志管理 |
| 个人中心 | `/profile` | ✅ 可用 | 修改密码、个人信息、登录记录、权限查询 |

---

## 详细功能清单

### 1. 登录认证 `/auth`

| 功能 | API | 说明 |
|------|-----|------|
| 用户登录 | `POST /auth/login` | 用户名 + 密码，返回 JWT |
| Token 刷新 | `GET /auth/refresh` | 使用 refresh_token 获取新 access_token |

**前端页面**：
- 登录页（用户名、密码输入，记住登录）
- Token 自动刷新逻辑

---

### 2. 用户管理 `/users`

| 功能 | API | 说明 |
|------|-----|------|
| 用户列表 | `GET /users` | 分页、筛选 |
| 用户详情 | `GET /users/:id` | 包含角色信息 |
| 创建用户 | `POST /users` | 用户名、密码、邮箱、角色 |
| 更新用户 | `PUT /users/:id` | 修改基本信息 |
| 删除用户 | `DELETE /users/:id` | 软删除 |
| 分配角色 | `PUT /users/:id/roles` | 批量分配角色 |

**前端页面**：
- 用户列表页（表格、搜索、分页）
- 用户详情/编辑弹窗
- 创建用户弹窗
- 角色分配弹窗（多选）

---

### 3. 角色管理 `/admin/roles`

| 功能 | API | 说明 |
|------|-----|------|
| 角色列表 | `GET /admin/roles` | 所有角色 |
| 角色详情 | `GET /admin/roles/:id` | 包含权限列表 |
| 创建角色 | `POST /admin/roles` | 名称、描述 |
| 更新角色 | `PUT /admin/roles/:id` | 修改名称、描述 |
| 删除角色 | `DELETE /admin/roles/:id` | 需检查是否有用户关联 |
| 分配权限 | `PUT /admin/roles/:id/permissions` | 批量分配权限 |

**前端页面**：
- 角色列表页（表格）
- 角色详情/编辑弹窗
- 权限分配弹窗（树形多选）

---

### 4. 权限管理 `/admin/permissions`

| 功能 | API | 说明 |
|------|-----|------|
| 权限列表 | `GET /admin/permissions` | 所有权限 |
| 权限详情 | `GET /admin/permissions/:id` | 单个权限 |
| 创建权限 | `POST /admin/permissions` | code、名称、描述 |
| 更新权限 | `PUT /admin/permissions/:id` | 修改名称、描述 |
| 删除权限 | `DELETE /admin/permissions/:id` | 需检查是否有角色关联 |

**前端页面**：
- 权限列表页（表格、按模块分组）
- 权限编辑弹窗

---

### 5. 首页大盘 `/admin/dashboard`

| 功能 | API | 说明 |
|------|-----|------|
| 系统概览 | `GET /admin/dashboard/overview` | 用户数、文档数、查询数 |
| 功能状态 | `GET /admin/dashboard/features` | 各模块可用性 |
| 查询趋势 | `GET /admin/dashboard/trends/queries` | 按时间统计查询量 |
| 文档趋势 | `GET /admin/dashboard/trends/documents` | 按时间统计文档上传量 |

**前端页面**：
- 首页大盘（卡片统计、趋势折线图）
- 功能状态面板（可用/部分/阻塞）

---

### 6. 文档治理 `/admin/documents`

| 功能 | API | 说明 |
|------|-----|------|
| 文档列表 | `GET /admin/documents` | 分页、筛选（状态、类型） |
| 文档详情 | `GET /admin/documents/:id` | 元数据、切片数 |
| 下载文档 | `GET /admin/documents/:id/download` | 原文件下载 |
| 删除文档 | `DELETE /admin/documents/:id` | 删除文档及向量 |
| 批量删除 | `DELETE /admin/documents/batch` | 批量删除 |

**前端页面**：
- 文档列表页（表格、筛选、分页）
- 文档详情弹窗（元数据、切片列表）
- 批量操作工具栏

---

### 7. 智能搜索运营 `/admin/search-ops`

| 功能 | API | 说明 |
|------|-----|------|
| 运营概览 | `GET /admin/search-ops/overview` | 热门查询、无结果查询、召回问题 |
| 热门查询 | `GET /admin/search-ops/queries/popular` | 按频次排序 |
| 无结果查询 | `GET /admin/search-ops/queries/no-result` | 用户搜索但无结果 |
| 召回问题 | `GET /admin/search-ops/queries/recall-issues` | 低召回率查询 |

**前端页面**：
- 搜索运营页（三个 Tab：热门/无结果/召回问题）
- 查询详情弹窗（展示相关文档）

---

### 8. AI 问答运营 `/admin/qa-ops`

| 功能 | API | 说明 |
|------|-----|------|
| 运营概览 | `GET /admin/qa-ops/overview` | 负反馈、引用失败、成本统计 |
| 负反馈列表 | `GET /admin/qa-ops/negative-feedback` | 用户标记不满意 |
| 引用失败 | `GET /admin/qa-ops/citation-failures` | 引用链接失效 |
| 成本统计 | `GET /admin/qa-ops/cost-summary` | Token 消耗、费用估算 |

**前端页面**：
- 问答运营页（三个 Tab：负反馈/引用失败/成本）
- 成本统计图表（按日期、模型分组）

---

### 9. 知识图谱运营 `/admin/graph-ops`

| 功能 | API | 说明 |
|------|-----|------|
| 运营概览 | `GET /admin/graph-ops/overview` | Schema、实体、关系、孤立节点 |
| Schema 查看 | `GET /admin/graph-ops/schema` | 实体类型、关系类型 |
| 实体列表 | `GET /admin/graph-ops/entities` | 所有实体（支持筛选） |
| 关系列表 | `GET /admin/graph-ops/relationships` | 所有关系 |
| 孤立节点 | `GET /admin/graph-ops/orphans` | 无关系的实体 |
| 冲突关系 | `GET /admin/graph-ops/conflicts` | 语义冲突的关系 |
| 全局图谱 | `GET /admin/graph-ops/graph` | 图谱可视化数据 |
| 节点搜索 | `GET /admin/graph-ops/search` | 关键词搜索节点 |
| 节点管理 | `GET /admin/graph-ops/nodes` | 节点 CRUD |
| 关系管理 | `GET /admin/graph-ops/relations` | 关系管理 |
| 图谱统计 | `GET /admin/graph-ops/statistics` | 节点总数、关系总数、文档节点等统计 |

**前端页面**：
- **全局图谱页**：图谱可视化画布（节点拖拽、缩放、连线展示）
- **左侧菜单**：全局图谱、节点管理、关系管理、图谱检索、图谱统计
- **右侧统计面板**：
  - 图谱数据统计：节点总数、关系总数、文档节点、知识点、标签、业务分类
  - 热门知识点 Top 5
  - 最近更新的节点
- **搜索栏**：关键词搜索、节点类型筛选、业务分类筛选、创建时间筛选
- **节点管理页**：节点列表、新增/编辑/删除节点
- **关系管理页**：关系列表、关系类型管理
- **图谱检索页**：按关键词检索相关节点
- **图谱统计页**：统计图表、趋势分析

---

### 10. 通知中心 `/admin/notifications`

| 功能 | API | 说明 |
|------|-----|------|
| 通知列表 | `GET /admin/notifications` | 分页、未读筛选 |
| 通知详情 | `GET /admin/notifications/:id` | 单条通知 |
| 标记已读 | `PUT /admin/notifications/:id/read` | 单条标记 |
| 批量已读 | `PUT /admin/notifications/batch/read` | 批量标记 |
| 删除通知 | `DELETE /admin/notifications/:id` | 删除单条 |

**前端页面**：
- 通知中心页（列表、未读高亮）
- 通知详情弹窗
- 批量操作工具栏

---

### 11. 系统配置 `/admin/system-config`

| 功能 | API | 说明 |
|------|-----|------|
| 模块状态 | `GET /admin/system-config/modules` | 各模块可用性 |
| 环境变量 | `GET /admin/system-config/env` | 非敏感环境变量 |
| 密钥状态 | `GET /admin/system-config/secrets` | 密钥配置状态（不返回值） |
| RAG 配置 | `GET /admin/system-config/rag` | RAG 服务配置 |

**前端页面**：
- 系统配置页（模块状态卡片）
- 环境变量展示（只读）
- 密钥管理（状态展示，不显示值）

---

### 12. 审计日志 `/admin/audit-logs` ⚠️

| 功能 | API | 说明 |
|------|-----|------|
| 日志列表 | `GET /admin/audit-logs` | 分页、筛选（用户、操作） |
| 日志详情 | `GET /admin/audit-logs/:id` | 单条日志 |

**状态**：数据库未启用时返回 disabled。

**前端页面**：
- 审计日志页（表格、时间筛选、用户筛选）
- 日志详情弹窗

---

### 13. 账号安全 `/admin/account-security` ⚠️

| 功能 | API | 说明 |
|------|-----|------|
| 登录历史 | `GET /admin/account-security/login-history` | 用户登录记录 |
| 失败锁定 | `POST /admin/account-security/lock` | 手动锁定用户 |
| 解锁用户 | `POST /admin/account-security/unlock` | 解锁用户 |

**状态**：登录失败锁定为进程内策略；忘记密码/MFA 需持久化和外部通道。

**前端页面**：
- 账号安全页（登录历史表格）
- 锁定/解锁操作

---

### 14. 菜单管理 `/admin/menus` ⚠️

| 功能 | API | 说明 |
|------|-----|------|
| 菜单树 | `GET /admin/menus/tree` | 侧边栏菜单结构 |
| 按钮权限 | `GET /admin/menus/buttons` | 页面按钮权限配置 |

**状态**：静态菜单树可用，持久化/排序需 schema。

**前端页面**：
- 菜单配置页（树形编辑）
- 按钮权限配置

---

### 15. 系统管理 `/admin/system`

| 功能 | API | 说明 |
|------|-----|------|
| 用户管理 | `GET /admin/system/users` | 用户列表、新增、编辑、删除、批量操作 |
| 角色权限 | `GET /admin/system/roles` | 角色管理、权限分配 |
| 系统配置 | `GET /admin/system/config` | 系统参数配置 |
| 日志管理 | `GET /admin/system/logs` | 系统日志查询、筛选 |

**前端页面**：
- **左侧菜单**：用户管理、角色权限、系统配置、日志管理
- **用户管理页**：
  - 顶部操作栏：新增用户、批量启用、批量禁用、批量删除
  - 筛选栏：用户名/姓名/手机号搜索、所属部门筛选、用户状态筛选、角色筛选、创建时间筛选
  - 用户列表表格：用户ID、用户名、姓名、所属部门、手机号（脱敏）、邮箱、角色、用户状态、创建时间、操作（编辑、禁用、删除）
  - 分页：总数显示、每页条数选择、页码导航
- **角色权限页**：角色列表、权限分配、新增/编辑角色
- **系统配置页**：系统参数配置表单
- **日志管理页**：日志列表、时间筛选、操作类型筛选

---

### 16. 个人中心 `/profile`

| 功能 | API | 说明 |
|------|-----|------|
| 个人信息 | `GET /users/me` | 当前用户信息（用户名、真实姓名、所属部门、职位、手机、邮箱、用户状态、创建时间、更新时间） |
| 修改密码 | `PUT /users/me/password` | 修改密码（当前密码、新密码） |
| 更新信息 | `PUT /users/me` | 修改邮箱、昵称、更换头像 |
| 登录记录 | `GET /users/me/login-history` | 用户登录记录（时间、IP、地点、设备、方式） |
| 权限查询 | `GET /users/me/permissions` | 当前用户权限列表 |

**前端页面**：
- **左侧菜单**：个人信息、密码修改、登录记录、权限查询
- **个人信息页**：
  - 头像展示与更换
  - 用户信息卡片：用户名、真实姓名、所属部门、职位、手机（脱敏）、邮箱、用户状态、创建时间、更新时间
- **密码修改页**：当前密码输入、新密码输入（带强度指示）、确认新密码、确认修改按钮
- **登录记录页**：登录时间、登录IP、登录地点、登录设备、登录方式、分页查询（开始日期、结束日期、登录IP筛选）
- **权限查询页**：权限模块、权限说明列表

---

## 技术栈建议

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 + TypeScript | 主流选择 |
| 构建 | Vite | 快速开发 |
| UI 库 | Ant Design 5.x | 企业级组件库 |
| 路由 | React Router 6 | 嵌套路由 |
| 状态 | Zustand / Redux Toolkit | 轻量或成熟方案 |
| HTTP | Axios | 请求库 |
| 图表 | ECharts / Recharts | 趋势图表 |
| 权限 | RBAC + 路由守卫 | 前端权限控制 |

---

## 权限控制映射

| 权限 code | 对应功能 |
|-----------|---------|
| `admin:system:read` | 系统配置、菜单管理、系统管理 |
| `admin:documents:read` | 文档治理（查看） |
| `admin:documents:write` | 文档治理（删除） |
| `admin:audit:read` | 审计日志 |
| `admin:role:*` | 角色管理 |
| `admin:permission:*` | 权限管理 |
| `admin:search-ops:read` | 搜索运营 |
| `admin:qa-ops:read` | 问答运营 |
| `admin:graph-ops:read` | 图谱运营 |
| `admin:rag:read` | RAG 运营 |
| `admin:notifications:read` | 通知中心（查看） |
| `admin:notifications:write` | 通知中心（标记已读） |
| `admin:account-security:read` | 账号安全 |

---

## 开发优先级建议

### P0（核心功能）

1. 登录认证（必须）
2. 首页大盘（快速了解系统状态）
3. 用户管理（基础）
4. 角色管理 + 权限管理（权限体系）

### P1（RAG 运营）

5. 文档治理
6. 搜索运营
7. 问答运营
8. 图谱运营

### P2（辅助功能）

9. 通知中心
10. 系统配置
11. 审计日志
12. 个人中心

### P3（增强功能）

13. 账号安全
14. 菜单管理

---

## 前端目录结构建议

```
admin/
├── src/
│   ├── pages/
│   │   ├── login/              # 登录页
│   │   ├── dashboard/          # 首页大盘
│   │   ├── users/              # 用户管理
│   │   ├── roles/              # 角色管理
│   │   ├── permissions/        # 权限管理
│   │   ├── documents/          # 文档治理
│   │   ├── search-ops/         # 搜索运营
│   │   ├── qa-ops/             # 问答运营
│   │   ├── graph-ops/          # 图谱运营
│   │   ├── notifications/      # 通知中心
│   │   ├── system-config/      # 系统配置
│   │   ├── audit-logs/         # 审计日志
│   │   ├── account-security/   # 账号安全
│   │   ├── menus/              # 菜单管理
│   │   └── profile/            # 个人中心
│   ├── components/
│   │   ├── layout/             # 布局（侧边栏、头部）
│   │   ├── permission/         # 权限组件（按钮权限）
│   │   └── charts/             # 图表组件
│   ├── services/
│   │   ├── api.ts              # API 调用
│   │   └── auth.ts             # 认证逻辑
│   ├── stores/
│   │   ├── user.ts             # 用户状态
│   │   └── permission.ts       # 权限状态
│   └── utils/
│       ├── request.ts          # HTTP 封装
│       └── permission.ts       # 权限判断
```

---

## 下一步

1. 初始化前端项目（Vite + React + Ant Design）
2. 实现登录认证 + Token 管理
3. 实现首页大盘（对接真实 API）
4. 按优先级逐个实现功能模块