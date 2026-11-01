# MinerU Cloud V4 接入现有 NestJS 文档解析

## 范围

- 只在 `MINERU_ENABLED=true` 与 `MINERU_PROVIDER=cloud_v4` 时，对 PDF、DOC/DOCX、PPT/PPTX、XLS/XLSX 启用 MinerU 云解析；其他类型保留原解析链路。
- 不创建新分支、不重写原 OSS、鉴权、BullMQ、索引、文档版本治理。
- 统一 MinerU ZIP 解析（Markdown 和可选 Office JSON），对 Excel HTML 表格按行拆分为一个业务记录一个 Markdown `###` 章节，保留原字段，不按固定模板假设十种表格拥有相同列名。
- SheetJS 只用于比对原 Excel，找到可信的实际 Sheet 和行号；无法定位时保留记录序号而**不伪造精确行号**。
- MinerU ZIP 中的图片转存到原项目受控 OSS，保留在对应表格单元格，调用 Vision 后补充可检索描述（如 `VISION_PROVIDER` 已启用）。不把临时 CDN 图片 URL 直接入库。
- MinerU 失败时默认为上传失败；只有显式开启 `MINERU_FALLBACK_LOCAL=true` 才使用原本地解析，并记录 `partial` warning。

## 接入步骤

把 patch 放项目根目录：

```bash
git apply --check MinerU_Cloud_V4_RAG.patch
git apply MinerU_Cloud_V4_RAG.patch
pnpm --filter backend exec jest --runInBand mineru-cloud.service.spec.ts
pnpm --filter backend exec tsc --noEmit
```

后端 `.env`（不要把真实密钥提交 GitHub）：

```dotenv
MINERU_ENABLED=true
MINERU_PROVIDER=cloud_v4
MINERU_API_KEY=your_new_private_api_key
MINERU_MODEL_VERSION=vlm
MINERU_MAX_WAIT_MS=180000
MINERU_FALLBACK_LOCAL=false
```

通过现有 `POST /api/v1/documents/upload/async` 上传真实测试文件。MinerU 需要外部网络、可用额度和有效 API Key。建议先使用脱敏数据验证企业隐私和授权。

## API 契约

MinerU 托管平台 `https://mineru.net/api/v4`：

1. `POST /file-urls/batch`，传 `{files:[{name,data_id}], model_version:'vlm'}` 获取 `batch_id` 和预签名 URL；
2. 对返回的 OSS URL 执行 `PUT` 上传原始字节（不要携带 Bearer，也不加 Content-Type）；
3. `GET /extract-results/batch/{batch_id}` 轮询，直到 `done` 或 `failed`；
4. 下载 `full_zip_url`，优先读取 `full.md` 和 `pdf_info` JSON，Excel 表格逐条处理。

官方文档：https://mineru.net/apiManage/docs

## 安全、性能、质量

- API Key 只从后端进程环境变量读取；代码与测试中没有真实密钥。
- 签名上传 URL 和 ZIP 下载 URL 均采用严格的 HTTPS 域名白名单，不允许重定向；避免由返回地址进行 SSRF。
- 设置 200MB 上传限制、100MB ZIP 下载限制、240MB 解压总限制、图片大小和数量限制，以及云任务总超时。使用方应同步调整文档上传最大限制。
- XLSX 中多个 Sheet、不同表头均逐表处理；未匹配到物理行号时标注 `记录 N`，不编造第 N 行。
- **重要限制**：MinerU 的不规则多层表头、行列合并、复杂交叉表以及漏行、错误图片关系仍可能出现。业务上线前必须用约十种模板的完整真实样本逐一回归。
- 旧项目的 `MarkdownChunker` 根据 `### 记录` 章节优先切分。同一记录很长时可继续拆多个 Chunk，各段必须保留来源章节路径。
- 这里没有新增数据库 `sourceRow` 字段；引用会在当前 Markdown / headingPath 中保留，精确数据库字段过滤需要另行迁移。

## 验收用例

- [ ] Excel `需求文档.xlsx` 全部 Sheet 均入库，Bug 行与附件不串行
- [ ] 两张截图保存在自有 OSS，不引用 MinerU 临时 CDN
- [ ] 检索 Bug 首页按钮时命中独立记录，能展示附件与来源
- [ ] 未识别模板保留原字段，不丢失列数据
- [ ] PDF/Word/PPT 仍可解析
- [ ] MinerU 403/超时/ZIP 缺失时显示任务失败，未生成假知识
- [ ] `MINERU_FALLBACK_LOCAL=true` 才允许本地回退

## 边界

此补丁已按当前 GitHub `main` 分支源码重新核对；如果你本地已经应用过此前 `/v1/tasks` 版补丁，先检查两个 MinerU Provider 是否重复注册，再选择云端 V4 实现。
