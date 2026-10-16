# 任务清单：图片以图搜图

## T001：RAG 图片检索链路

- 依赖：无
- 允许文件：Backend image-index、rag-admin service/controller 及其定向测试文件。
- 操作：增加图片 embedding 检索、复用 ACL 和 multipart 内部 API。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：Backend 定向 Jest 命令（含 `rag-admin.image-assets.spec.ts`）及 `pnpm --dir backend build`
- 完成定义：单测和构建通过。
- 状态：done
- 证据：Backend 定向测试 4 套／39 项通过；Backend build 通过。

## T002：Admin Backend 上传代理

- 依赖：T001
- 允许文件：AdminImages controller 和 RagClientService 及其定向测试文件。
- 操作：从已验证请求派生 user／tenant／role，限流并转发 multipart 图片。
- 对应 AC：AC-01、AC-02、AC-03
- 验证：Admin Backend 定向 Jest 命令及 `pnpm --dir admin-backend build`
- 完成定义：代理测试和构建通过。
- 状态：done
- 证据：Admin Backend 定向测试 2 套／37 项通过；build 通过。

## T003：管理端入口

- 依赖：T002
- 允许文件：`admin/src/pages/image-search/index.tsx`、`admin/src/pages/image-search/service.ts`
- 操作：增加以图搜图标签、选择图片、5 MB 提示和 multipart 请求。
- 对应 AC：AC-01、AC-03、AC-04
- 验证：Admin Biome lint、Admin build
- 完成定义：目标文件 lint 与管理端 build 通过。
- 状态：done
- 证据：Biome 检查通过；Admin build 通过。

## T004：记录验证结果

- 依赖：T001、T002、T003
- 允许文件：`ROADMAP.md` 与本功能计划文档。
- 操作：记录完成状态、验证例外和进度文档索引。
- 对应 AC：AC-01–AC-04
- 验证：检查计划清单文件的 `git diff --check`。
- 完成定义：文档准确记录实现范围、测试结果和未验证事项。
- 状态：done
- 证据：`git diff --check` 通过；限制写入验证记录与 Roadmap。
