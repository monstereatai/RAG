#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const server = new McpServer({
  name: 'rag-smoke-mcp',
  version: '1.0.0',
});

server.registerTool(
  'rag_smoke_echo',
  {
    description: 'Echo a short message to verify MCP stdio tool loading.',
    inputSchema: {
      message: z.string().describe('Message to echo'),
    },
  },
  async ({ message }) => ({
    content: [
      {
        type: 'text',
        text: `mcp-smoke:${message}`,
      },
    ],
  }),
);

server.registerTool(
  'rag_smoke_status',
  {
    description: 'Return a fixed status payload for RAG MCP integration smoke tests.',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: true, service: 'rag-smoke-mcp' }),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
