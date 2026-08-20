---
name: agent-code-review
description: 为 Agent Coding 任务提供代码修改、测试和风险审查步骤
tags: [Agent, Coding, 代码, 测试, review]
---

# Agent Code Review Skill

适用于代码生成、修复、重构和项目交付任务。

执行约束：

1. 先读取项目规范、ROADMAP 和相关代码，再生成修改计划。
2. 只修改任务范围内的文件，不修改密钥、环境配置、数据库迁移或部署配置。
3. 生成代码后执行类型检查、定向测试和差异检查。
4. 交付时说明修改文件、验证结果和未完成的真实环境验证。
