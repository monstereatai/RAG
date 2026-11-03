# Code RAG 编译错误修复：缺少动态语法注册

目标：**之前安装过 RAG_Code_RAG_MultiLanguage_Implementation_20261103.zip 的项目**。

根因：`@ast-grep/napi@0.45.3` 仅内置 `Lang.Html/JavaScript/Tsx/Css/TypeScript`。其他语言使用外置 `@ast-grep/lang-*` + `registerDynamicLanguage`。

## 用法（已安装旧补丁的仓库）

```bash
python3 fix_code_rag_grammars.py /Users/monster/Documents/GitHub/code/RAG --check
python3 fix_code_rag_grammars.py /Users/monster/Documents/GitHub/code/RAG
cd /Users/monster/Documents/GitHub/code/RAG
pnpm install --no-frozen-lockfile
pnpm --filter backend build
pnpm --filter backend exec jest --runInBand code-parser.util.spec.ts code-chunker.util.spec.ts
```

> pnpm 10 的语言扩展包有安装后脚本，脚本会把 16 个 `@ast-grep/lang-*` 加到 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`，以允许其合法解包。
> 原本的 peer dependency 警告不等于构建失败，不建议为了这次修复升级或降级所有 React/Redis/LangChain。

## 验证限制

本环境不能直接访问 npm，已做静态脚本/语言映射检查；真正的完整 `pnpm install`、编译及 Jest 需在项目机器上执行。请将运行结果反馈，以便继续排除其他错误。
