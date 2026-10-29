import fs from 'fs';

const p = '/Users/monster/Documents/GitHub/code/RAG/ROADMAP.md';
let content = fs.readFileSync(p, 'utf8');

// Replace duplicate sections if any.
// The string "- **P0/P2 Mem0 长期记忆方案定稿与集成完成**" appears multiple times.
const pattern = /\- \*\*P0\/P2 Mem0 长期记忆方案定稿与集成完成\*\*(.*?\n)+?.*下一步：基于真实密钥\/环境的外部联调[^\n]*\n/g;
let matchCount = 0;
content = content.replace(pattern, (match) => {
    matchCount++;
    if (matchCount === 1) {
        // Keep the first one, but we'll modify it
        let modified = match.replace(
            '- **P2 MCP 协议集成完成**（2026-06-19）：\n  - **组件与逻辑**：使用 `@langchain/mcp-adapters` 的 `MultiServerMCPClient`，支持从 `mcp-servers.yaml` 配置加载 MCP 服务器，实现工具集成的统一标准。\n  - **测试与验证**：编写并运行了 `McpProvider` 的单元测试，全面覆盖了 disabled、缺少配置文件、配置文件为空，以及成功连接加载工具（包含 Jest 拦截 Mock 和 Connection Shutdown 逻辑）的所有分支，均 100% 通过。',
            '- **P2 MCP 协议深度集成完成**（2026-06-19）：\n  - **组件与逻辑**：使用 `@langchain/mcp-adapters` 统一连接标准，实现 `McpProvider`。新增可观测性接口 `McpController` (`GET /api/mcp/tools`)。\n  - **Agent 绑定**：重构 `AgenticRagService` 核心生成逻辑，接入 `createReactAgent` 与流式 `streamEvents`，使得 LLM 支持动态监测和交互式调用底层环境工具。'
        );
        return modified;
    }
    return ''; // Remove duplicates
});

fs.writeFileSync(p, content);
console.log('Fixed and updated ROADMAP.md');
