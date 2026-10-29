# 对外兼容边界

Chat HTTP/SSE 与 AGUI 已共用 ChatService。保留现有 DTO、SSE/AGUI 事件名及顺序；MCP 与后台继续通过既有 HTTP 契约访问。此次重构不新增公开字段、不修改权限和版本时间判断。

`contract-snapshot.json` 记录改码前 controllers、DTO、Chat/AGUI 事件相关源码、MCP server 源码的 SHA256，用于区分对外行为改动和内部搬迁；哈希相等只能证明该文件未变，不能替代端到端回放。类型 re-export 的文件可发生兼容性变更，须另做静态契约检查/测试。

重点逐批核对：答案字段、chunk ID/source/页码/offset、RRF totalScore 与 rerankScore、tenant/user scope、lifecycle/有效时间、审批 revision、取消后终态、历史会话、请求/run/trace/step ID。无已批准的对外差异。

## 实施后的差异

- 64 个契约源码中，只有 `chat.dto.ts` 的 ChatMode 等价类型 alias 和 `agui.service.ts` 的 type import 变动；Controller、DTO runtime decorators、AGUI 事件映射和 MCP 源码未变。
- Chat 的已有诊断事件附加系统上下文 estimated/budget/overflow/droppedSources，已有事件名称与相对发送顺序不变。RequestContext 的 contextBudget 为 optional，旧 checkpoint/直连入口兼容。
- 可观察行为修复单列：扩展证据执行生命周期门禁；上下文实际裁剪；语义总结使用同一注入清洗与可取消超时。这些是目标范围内的治理修复，不冒充字节级答案一致。
- 历史有效时间区间、生产权限矩阵与真实回放仍待确认/外部验证。
