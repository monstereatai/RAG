# Admin Backend ↔ Admin Frontend 对接实施计划

## 核心问题

前端调用 `/api/admin/*` 路径，后端实际路由前缀不统一（有的用 `/admin/*`，有的用 `/users`、`/roles`、`/permissions`、`/auth`），且前端代理指向 `localhost:3001`。

需要做两件事：
1. **后端**：补齐前端需要但后端缺失的 API 路由，统一加 `/api` 前缀
2. **前端**：确保 service 层调用的路径与后端路由完全匹配

## 前端 API 路径 vs 后端路由对照表

| # | 前端调用路径 | 后端现有路由 | 差异 | 需要动作 |
|---|------------|------------|------|---------|
| **Auth** | | | | |
| 1 | `POST /api/auth/login` | `POST /auth/login` | 缺 `/api` 前缀 | 后端加全局 `/api` 前缀 |
| 2 | `GET /api/auth/refresh` | `GET /auth/refresh` | 同上 | 同上 |
| **Dashboard** | | | | |
| 3 | `GET /api/admin/dashboard/overview` | `GET /admin/dashboard` | 路径不同 | 后端新增 `dashboard/overview` + `dashboard/trend` |
| 4 | `GET /api/admin/dashboard/trend` | 无 | 缺失 | 后端新增 |
| **Documents** | | | | |
| 5 | `GET /api/admin/documents` | `GET /admin/documents` | 缺 `/api` | 全局前缀解决 |
| 6 | `DELETE /api/admin/documents/:id` | 无 DELETE | 缺失 | 后端新增 DELETE |
| 7 | `POST /api/admin/documents/:id/reprocess` | `POST /admin/documents/:id/reindex` | 路径不同 | 后端新增 reprocess 路由 |
| 8 | `GET /api/admin/documents/:id` | `GET /admin/documents/:docId` | 缺 `/api` | 全局前缀解决 |
| 9 | `GET /api/admin/documents/:id/chunks` | `GET /admin/documents/:docId/chunks` | 同上 | 同上 |
| **Users** | | | | |
| 10 | `GET /api/admin/users` | `GET /users` | 路径前缀不同 | 后端新增 `/admin/users` 路由 |
| 11 | `POST /api/admin/users` | `POST /users` | 同上 | 同上 |
| 12 | `PATCH /api/admin/users/:id` | `PUT /users/:id` | PATCH vs PUT + 路径 | 后端新增 PATCH + admin 前缀 |
| 13 | `DELETE /api/admin/users/:id` | `DELETE /users/:id` | 路径前缀不同 | 同上 |
| 14 | `POST /api/admin/users/:id/reset-password` | 无 | 缺失 | 后端新增 |
| **Roles** | | | | |
| 15 | `GET /api/admin/roles` | `GET /roles` | 路径前缀不同 | 后端新增 `/admin/roles` 路由 |
| 16 | `POST /api/admin/roles` | `POST /roles` | 同上 | 同上 |
| 17 | `PATCH /api/admin/roles/:id` | `PUT /roles/:id` | PATCH vs PUT + 路径 | 后端新增 PATCH + admin 前缀 |
| 18 | `DELETE /api/admin/roles/:id` | `DELETE /roles/:id` | 路径前缀不同 | 同上 |
| 19 | `GET /api/admin/permissions` | `GET /permissions` | 路径前缀不同 | 后端新增 `/admin/permissions` 路由 |
| **Permissions** | | | | |
| 20 | `GET /api/admin/permissions` | `GET /permissions` | 路径前缀不同 | 后端新增 `/admin/permissions` 路由 |
| 21 | `POST /api/admin/permissions` | `POST /permissions` | 同上 | 同上 |
| 22 | `PATCH /api/admin/permissions/:id` | `PUT /permissions/:id` | PATCH vs PUT + 路径 | 后端新增 PATCH + admin 前缀 |
| 23 | `DELETE /api/admin/permissions/:id` | `DELETE /permissions/:id` | 路径前缀不同 | 同上 |
| **Notifications** | | | | |
| 24 | `GET /api/admin/notifications` | `GET /admin/notifications` | 缺 `/api` | 全局前缀解决 |
| 25 | `PATCH /api/admin/notifications/:id/read` | `POST /admin/notifications/:id/read` | PATCH vs POST | 后端新增 PATCH 路由 |
| 26 | `PATCH /api/admin/notifications/read-all` | `POST /admin/notifications/read-all` | PATCH vs POST | 后端新增 PATCH 路由 |
| 27 | `DELETE /api/admin/notifications/:id` | 无 DELETE | 缺失 | 后端新增 |
| **Audit Logs** | | | | |
| 28 | `GET /api/admin/audit-logs` | `GET /admin/audit-logs` | 缺 `/api` | 全局前缀解决 |
| **System Config** | | | | |
| 29 | `GET /api/admin/config` | `GET /admin/system-config` | 路径不同 | 后端新增 `/admin/config` 路由 |
| 30 | `PATCH /api/admin/config/:key` | 无 | 缺失 | 后端新增 |
| **Account Security** | | | | |
| 31 | `GET /api/admin/account/security` | `GET /admin/account-security/policy` | 路径不同 | 后端新增 |
| 32 | `POST /api/admin/account/change-password` | 无 | 缺失 | 后端新增 |
| 33 | `POST /api/admin/account/two-factor` | `POST /admin/account-security/mfa/setup` | 路径不同 | 后端新增 |
| **Menus** | | | | |
| 34 | `GET /api/admin/menus/tree` | `GET /admin/menus/tree` | 缺 `/api` | 全局前缀解决 |
| 35 | `POST /api/admin/menus` | 无 | 缺失 | 后端新增 |
| 36 | `PATCH /api/admin/menus/:id` | 无 | 缺失 | 后端新增 |
| 37 | `DELETE /api/admin/menus/:id` | 无 | 缺失 | 后端新增 |
| **Search Ops** | | | | |
| 38 | `GET /api/admin/search-ops/records` | 无 | 缺失 | 后端新增 |
| 39 | `GET /api/admin/search-ops/popular` | `GET /admin/search-ops/queries/popular` | 路径不同 | 后端新增 |
| 40 | `GET /api/admin/search-ops/stats` | 无 | 缺失 | 后端新增 |
| **QA Ops** | | | | |
| 41 | `GET /api/admin/qa-ops/records` | 无 | 缺失 | 后端新增 |
| 42 | `GET /api/admin/qa-ops/stats` | 无 | 缺失 | 后端新增 |
| 43 | `PATCH /api/admin/qa-ops/records/:id/feedback` | 无 | 缺失 | 后端新增 |
| **Graph Ops** | | | | |
| 44 | `GET /api/admin/graph-ops/stats` | 无 | 缺失 | 后端新增 |
| 45 | `GET /api/admin/graph-ops/schema` | `GET /admin/graph-ops/schema` | 缺 `/api` | 全局前缀解决 |
| 46 | `GET /api/admin/graph-ops/nodes` | `GET /admin/graph-ops/entities` | 路径不同 | 后端新增 nodes 路由 |
| 47 | `GET /api/admin/graph-ops/search` | 无 | 缺失 | 后端新增 |
| **Profile** | | | | |
| 48 | `GET /api/currentUserDetail` | 无 | 缺失 | 后端新增 |
| 49 | `GET /api/accountSettingCurrentUser` | 无 | 缺失 | 后端新增 |

## 实施步骤

### Step 1: 后端加全局 `/api` 前缀
- 在 `main.ts` 中 `app.setGlobalPrefix('api')`
- 这样所有路由自动加 `/api` 前缀
- health 等公开接口需要排除

### Step 2: 后端补齐 admin 前缀路由
- 新建 `AdminUsersController`（`/admin/users`），代理到 UserService
- 新建 `AdminRolesController`（`/admin/roles`），代理到 RoleService
- 新建 `AdminPermissionsController`（`/admin/permissions`），代理到 PermissionService
- 支持 PATCH 方法

### Step 3: 后端补齐缺失的 API
- Dashboard: `overview` + `trend`
- Documents: DELETE + reprocess
- Users: reset-password
- Notifications: PATCH read + DELETE
- System Config: `/admin/config` + PATCH
- Account Security: security info + change-password + two-factor
- Menus: CRUD
- Search/QA/Graph Ops: records/stats/nodes/search
- Profile: currentUserDetail + accountSettingCurrentUser

### Step 4: 验证
- `npm run verify`（build + lint + test + e2e）
- 启动两个服务，前端代理到 admin-backend
- 前端登录、各页面功能验证

### Step 5: 更新 ROADMAP
