import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

const configPath = resolve(
  process.env.MCP_CONFIG_PATH ?? '../workspace/mcp-servers.yaml',
);
const config = yaml.load(await readFile(configPath, 'utf8'));
const client = new MultiServerMCPClient({
  mcpServers: config?.mcpServers ?? {},
});

try {
  const tools = await client.getTools();
  const toolNames = tools.map((tool) => tool.name).sort();
  const statusTool = tools.find((tool) => tool.name === 'rag_smoke_status');
  const statusResult = statusTool ? await statusTool.invoke({}) : undefined;

  console.log(
    JSON.stringify(
      {
        ok: Boolean(statusTool),
        configPath,
        serverCount: Object.keys(config?.mcpServers ?? {}).length,
        toolCount: tools.length,
        toolNames,
        statusCalled: Boolean(statusResult),
      },
      null,
      2,
    ),
  );

  if (!statusTool) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
