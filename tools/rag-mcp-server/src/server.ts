#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { RagMcpError, toRagMcpError } from './errors.js';
import { buildGameMarketingPrompt, type GameToolKind } from './game-tools.js';
import { RagApiClient, type ChatMode, type SearchResult } from './rag-api-client.js';

const chatModeSchema = z.enum(['simple', 'agentic', 'auto']);

export async function createServer(): Promise<McpServer> {
  const config = await loadConfig();
  const client = new RagApiClient({
    baseUrl: config.baseUrl,
    token: config.token,
    username: config.username,
    password: config.password,
    timeoutMs: config.timeoutMs,
  });
  const server = new McpServer({
    name: 'rag-mcp-server',
    version: '0.1.0',
  });

  server.registerTool(
    'rag_health',
    {
      title: 'Check RAG backend health',
      description: 'Check the configured RAG backend health endpoint. This tool does not require auth.',
      inputSchema: {},
    },
    async () =>
      runTool(async () => ({
        baseUrl: config.baseUrl,
        tokenSource: config.tokenSource,
        health: await client.health(),
      })),
  );

  server.registerTool(
    'rag_search',
    {
      title: 'Search RAG knowledge',
      description:
        'Return retrieval evidence chunks for inspection and coding context, including approved reviewed-correction evidence when it matches. This tool does not generate a final answer; use rag_ask for direct factual questions or QA Ops-equivalent answers.',
      inputSchema: {
        query: z.string().min(1).describe('Search query.'),
        limit: z.number().int().positive().max(20).optional().describe('Maximum chunks to return.'),
      },
    },
    async ({ query, limit }) =>
      runTool(async () => normalizeSearchResult(await client.search(query, limit ?? config.defaultLimit))),
  );

  server.registerTool(
    'rag_context',
    {
      title: 'Build RAG coding context',
      description:
        'Build a coding context package from RAG/Karpathy/Obsidian knowledge before asking an AI coding agent to implement.',
      inputSchema: {
        task: z.string().min(1).describe('Coding task or product requirement.'),
        limit: z.number().int().positive().max(20).optional(),
        includeRoadmap: z.boolean().optional(),
        matchSkill: z.boolean().optional(),
        skillLimit: z.number().int().positive().max(10).optional(),
      },
    },
    async ({ task, limit, includeRoadmap, matchSkill, skillLimit }) =>
      runTool(async () =>
        client.contextPackage({
          task,
          limit: limit ?? config.defaultLimit,
          includeRoadmap,
          matchSkill,
          skillLimit,
        }),
      ),
  );

  server.registerTool(
    'rag_ask',
    {
      title: 'Ask RAG',
      description:
        'Ask a direct factual or business question through the full RAG answer pipeline used by QA Ops, including retrieval quality gates, reviewed Bad Case corrections and Obsidian evidence when available.',
      inputSchema: {
        query: z.string().min(1),
        mode: chatModeSchema.default('auto'),
        threadId: z.string().optional(),
      },
    },
    async ({ query, mode, threadId }) =>
      runTool(async () => compactAskResult(await client.ask({ query, mode, threadId }))),
  );

  server.registerTool(
    'rag_graph_query',
    {
      title: 'Query GraphRAG',
      description: 'Query the GraphRAG endpoint for entity/relation context.',
      inputSchema: {
        query: z.string().min(1),
      },
    },
    async ({ query }) => runTool(async () => client.graphQuery(query)),
  );

  server.registerTool(
    'rag_agent_domains',
    {
      title: 'List Supervisor agent domains',
      description:
        'List domains supported by the Supervisor multi-agent pipeline and the agent subsets used behind each domain.',
      inputSchema: {},
    },
    async () => runTool(async () => client.supervisorDomains()),
  );

  server.registerTool(
    'rag_agent_pipeline',
    {
      title: 'Run Supervisor multi-agent pipeline',
      description:
        'Run the Supervisor multi-agent pipeline. The backend routes the task to a domain and executes researcher/analyst/writer/critic/editor subsets.',
      inputSchema: {
        task: z.string().min(1).describe('Complex task for the multi-agent pipeline.'),
      },
    },
    async ({ task }) =>
      runTool(async () => compactSupervisorResult(await client.supervisorQuery(task))),
  );

  server.registerTool(
    'rag_production_workflow_context',
    {
      title: 'Get approved production workflow coding context',
      description:
        'Return the approved, completed production workflow stages and Markdown deliverables for Codex or another coding agent. Only completed workflows are accepted.',
      inputSchema: {
        activityName: z.string().min(1).describe('Activity or project name, for example act10.'),
      },
    },
    async ({ activityName }) => runTool(async () => client.productionWorkflowCodingContext(activityName)),
  );

  server.registerTool(
    'rag_production_workflow_activities',
    {
      title: 'List production workflow activities',
      description:
        'List production and operations activities visible to the current MCP user, including status, completed roles and updated time. Use this before getting a coding context by activity name.',
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const workflows = await client.productionWorkflowActivities();
        return workflows.map((workflow) => ({
          activityName: workflow.projectId,
          status: workflow.status,
          completedRoles: workflow.completedRoles ?? [],
          selectedRoles: workflow.selectedRoles ?? [],
          updatedAt: workflow.updatedAt ?? null,
        }));
      }),
  );

  registerGameTool(server, client, 'rag_game_plan', 'plan');
  registerGameTool(server, client, 'rag_game_checklist', 'checklist');
  registerGameTool(server, client, 'rag_game_tracking', 'tracking');
  registerGameTool(server, client, 'rag_game_region_check', 'region-check');

  return server;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(helpText());
    return;
  }

  const server = await createServer();
  await server.connect(new StdioServerTransport());
}

function registerGameTool(
  server: McpServer,
  client: RagApiClient,
  name: string,
  kind: GameToolKind,
): void {
  server.registerTool(
    name,
    {
      title: name,
      description: `Generate game marketing ${kind} context from RAG knowledge.`,
      inputSchema: {
        activity: z.string().min(1).describe('Activity, marketing campaign, or official website requirement.'),
        region: z.string().optional().describe('Target region, for example CN, TW, SEA, global.'),
        platform: z.string().optional().describe('Mini program, H5, PC official website, mobile official website.'),
        product: z.string().optional().describe('Game or product name.'),
        constraints: z.string().optional().describe('Known business or technical constraints.'),
        mode: chatModeSchema.default('auto'),
      },
    },
    async ({ activity, region, platform, product, constraints, mode }) =>
      runTool(async () => {
        const prompt = buildGameMarketingPrompt(kind, {
          activity,
          region,
          platform,
          product,
          constraints,
          mode,
        });
        return compactAskResult(await client.ask({ query: prompt, mode: mode as ChatMode }));
      }),
  );
}

async function runTool(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const err = toRagMcpError(error);
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(formatError(err), null, 2),
        },
      ],
    };
  }
}

function normalizeSearchResult(result: SearchResult): Record<string, unknown> {
  const chunks = result.chunks ?? result.results ?? [];
  return {
    query: result.query,
    count: chunks.length,
    chunks: chunks.map(compactChunk),
    status: result.status,
    retrievalSufficient: result.retrievalSufficient,
    retrievalReason: result.retrievalReason,
  };
}

function compactAskResult(result: Record<string, unknown>): Record<string, unknown> {
  const references = Array.isArray(result.references) ? result.references.map(compactChunk) : undefined;
  return {
    answer: result.answer,
    route: result.route,
    mode: result.mode,
    confidence: result.confidence,
    retrievalSufficient: result.retrievalSufficient,
    retrievalReason: result.retrievalReason,
    obsidianPaths: result.obsidianPaths,
    references,
  };
}

function compactSupervisorResult(result: {
  domain: string;
  answer: string;
  confidence: number;
  stages: Array<{ agent: string; durationMs: number; confidence: number }>;
  totalDurationMs: number;
}): Record<string, unknown> {
  return {
    domain: result.domain,
    answer: result.answer,
    confidence: result.confidence,
    stages: result.stages,
    totalDurationMs: result.totalDurationMs,
  };
}

function compactChunk(chunk: object): Record<string, unknown> {
  const record = chunk as Record<string, unknown>;
  return {
    id: record.id ?? record.chunkId,
    docId: record.docId,
    title: record.title,
    score: record.totalScore ?? record.score ?? record.cosineScore ?? record.bm25Score,
    content: typeof record.content === 'string' ? truncate(record.content, 1200) : record.content,
    source: record.source,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function formatError(error: RagMcpError): Record<string, unknown> {
  return {
    error: {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    },
  };
}

function helpText(): string {
  return [
    'rag-mcp-server',
    '',
    'MCP stdio server for RAG knowledge tools.',
    '',
    'Configuration priority:',
    '  RAG_MCP_BASE_URL / RAG_MCP_API_KEY',
    '  RAG_MCP_TOKEN',
    '  RAG_MCP_USERNAME / RAG_MCP_PASSWORD',
    '  RAG_BASE_URL / RAG_TOKEN',
    '  ~/.config/rag-cli/config.json',
    '',
    'Tools:',
    '  rag_health',
    '  rag_search',
    '  rag_context',
    '  rag_ask',
    '  rag_graph_query',
    '  rag_agent_domains',
    '  rag_agent_pipeline',
    '  rag_production_workflow_context',
    '  rag_production_workflow_activities',
    '  rag_game_plan',
    '  rag_game_checklist',
    '  rag_game_tracking',
    '  rag_game_region_check',
    '',
  ].join('\n');
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error('unknown startup error');
  process.stderr.write(`rag-mcp-server failed: ${err.message}\n`);
  process.exitCode = 1;
});
