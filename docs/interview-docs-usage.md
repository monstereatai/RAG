# 面试文档使用说明

更新时间：2026-07-07

## 这几份文件分别干什么

| 文件 | 用途 | 什么时候看 |
|---|---|---|
| `docs/jd-requirements-project-mapping.md` | 对照大厂 JD：岗位要求、项目实现、代码位置、面试边界 | 投递前、面试前判断岗位匹配度 |
| `docs/jd-gap-implementation-status.md` | 看缺口状态：哪些已补、哪些只是基础版、哪些仍需外部条件 | 面试官追问“还有哪些没做完”时 |
| `INTERVIEW_PLAYBOOK.md` | 面试回答稿：项目介绍、7 问口径、追问回答、反问清单 | 面试前背诵和临场组织语言 |
| `ROADMAP.md` | 项目真实进度源：已完成、阻塞、最近验证 | 回答“当前真实状态”和“验证证据”时 |
| `docs/remaining-enhancement-plan.md` | 一线大厂生产化差距：真实数据、权限、压测、安全、运维 | 讲生产化差距和下一步计划时 |

## 推荐阅读顺序

### 1. 投递岗位前

先读：

```text
docs/jd-requirements-project-mapping.md
```

重点看：

- `公司 / 行业要求对照`
- `JD 要求与项目实现一一对照`
- `按岗位类型怎么讲`

目的：

```text
判断这个岗位要什么，项目哪些能力能对上，哪些不要硬说。
```

### 2. 面试前 30 分钟

按顺序读：

```text
docs/jd-requirements-project-mapping.md
docs/jd-gap-implementation-status.md
INTERVIEW_PLAYBOOK.md
```

重点：

- 先用 `jd-requirements-project-mapping.md` 找岗位匹配点。
- 再用 `jd-gap-implementation-status.md` 确认哪些只能说“基础版”。
- 最后用 `INTERVIEW_PLAYBOOK.md` 组织成自然回答。

### 3. 面试官问“项目现在到底完成到什么程度”

读：

```text
ROADMAP.md
```

回答时只说 ROADMAP 里已经实现并验证过的内容。

不要把 `INTERVIEW_PLAYBOOK.md` 里的面试表达当作真实进度源。

### 4. 面试官问“一线大厂还差什么”

读：

```text
docs/jd-gap-implementation-status.md
docs/remaining-enhancement-plan.md
```

回答结构：

```text
主干能力已实现：RAG、Agentic Workflow、Tool Calling、Memory、Eval、Observability。
本地基础版已补：Prompt Injection、Prompt Registry、Tool Registry、Agent 任务评测脚手架。
生产级仍缺：真实数据、真实业务 API、IAM/DLP、生产 SLA、灰度、成本预算、真实多模态模型。
```

## 面试时怎么快速定位

| 面试问题 | 查哪个文件 |
|---|---|
| 你这个项目和阿里/腾讯/百度/字节/美团 JD 对得上吗？ | `docs/jd-requirements-project-mapping.md` |
| 你项目里哪些没实现？ | `docs/jd-gap-implementation-status.md` |
| RAG 怎么做？ | `INTERVIEW_PLAYBOOK.md` |
| Agent 怎么协调？ | `INTERVIEW_PLAYBOOK.md` + `docs/jd-requirements-project-mapping.md` |
| 工具怎么调用？ | `INTERVIEW_PLAYBOOK.md` + `docs/jd-gap-implementation-status.md` |
| Prompt Injection 怎么防？ | `docs/jd-gap-implementation-status.md` |
| Prompt 怎么管理版本？ | `docs/jd-gap-implementation-status.md` |
| Agent 成功率怎么评估？ | `docs/jd-gap-implementation-status.md` |
| 金融/证券生产还差什么？ | `docs/remaining-enhancement-plan.md` |
| 当前最新进度和验证命令是什么？ | `ROADMAP.md` |

## 不能混用的地方

- `ROADMAP.md` 是真实进度源。
- `INTERVIEW_PLAYBOOK.md` 是表达话术，不是进度源。
- `docs/jd-requirements-project-mapping.md` 是 JD 对照，不是承诺所有 JD 能力都已完成。
- `docs/jd-gap-implementation-status.md` 是缺口状态，不要把“基础版已实现”说成“生产平台已完成”。
- `docs/remaining-enhancement-plan.md` 里的真实生产/真实数据/真实合规项，不能靠本地模拟冒充完成。

## 面试前 5 分钟速记

```text
1. 主干对得上：RAG、Agentic、Tool Calling、Memory、Eval、Observability、Admin Ops。
2. 本地已补：Prompt Injection 基础防护、Prompt Registry、Tool Registry、Agent 任务评测脚手架。
3. 生产仍缺：真实业务 API、真实组织权限、真实多模态、金融合规、SLA、灰度、成本预算。
4. 不能吹：A2A、SFT/RLHF、金融生产合规、完整多模态理解、生产级高可用。
```

