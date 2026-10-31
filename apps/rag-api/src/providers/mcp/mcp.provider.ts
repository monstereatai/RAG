import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  MultiServerMCPClient,
  type ClientConfig,
} from '@langchain/mcp-adapters';
import type { ToolRegistryEntry } from '../../tools/tool-registry';

export interface McpToolView {
  name: string;
  description?: string;
  schema?: unknown;
  source?: string;
  policy: ToolRegistryEntry;
}

interface McpToolRecord {
  tool: DynamicStructuredTool;
  source: string;
  policy: ToolRegistryEntry;
}

@Injectable()
export class McpProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpProvider.name);
  private mcpClient: MultiServerMCPClient | null = null;
  private tools = new Map<string, McpToolRecord>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (!this.configService.get<boolean>('mcp.enabled')) {
      this.logger.log('MCP is disabled. Set MCP_ENABLED=true to enable it.');
      return;
    }

    const configuredPath = this.configService.get<string>('mcp.configPath');
    const configPath = path.resolve(
      configuredPath ??
        path.resolve(process.cwd(), '../../workspace/mcp-servers.yaml'),
    );

    if (!fs.existsSync(configPath)) {
      this.logger.log(
        `No MCP servers configuration found at ${configPath}. MCP tools disabled.`,
      );
      return;
    }

    try {
      const fileContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContent) as {
        mcpServers?: ClientConfig['mcpServers'];
        mcpToolPolicies?: unknown;
      };

      if (
        !config ||
        !config.mcpServers ||
        Object.keys(config.mcpServers).length === 0
      ) {
        this.logger.log(
          'MCP servers configuration is empty. No servers initialized.',
        );
        return;
      }

      this.logger.log(
        `Initializing MCP servers: ${Object.keys(config.mcpServers).join(', ')}`,
      );

      const serverNames = Object.keys(config.mcpServers);
      this.mcpClient = new MultiServerMCPClient({
        mcpServers: config.mcpServers,
        prefixToolNameWithServerName: true,
        additionalToolNamePrefix: 'mcp',
      });

      // Only tools with a complete, explicit execution policy enter the Agent runtime.
      const loadedTools = await this.mcpClient.getTools();
      const policies = this.parseToolPolicies(config.mcpToolPolicies);
      const nameCounts = new Map<string, number>();
      for (const tool of loadedTools) {
        nameCounts.set(tool.name, (nameCounts.get(tool.name) ?? 0) + 1);
      }
      this.tools.clear();
      for (const tool of loadedTools) {
        const policy = policies.get(tool.name);
        if (!policy) {
          this.logger.warn(
            'MCP tool "' +
              tool.name +
              '" is not exposed: no valid explicit policy is configured.',
          );
          continue;
        }
        if ((nameCounts.get(tool.name) ?? 0) > 1) {
          this.logger.error(
            'MCP tool "' +
              tool.name +
              '" is not exposed: the alias is ambiguous.',
          );
          continue;
        }
        if (
          policy.tenantScope === 'tenant' &&
          !this.toolAcceptsTenantId(tool)
        ) {
          this.logger.warn(
            'MCP tool "' +
              tool.name +
              '" is not exposed: tenant-scoped tools must declare a tenantId input field.',
          );
          continue;
        }
        this.tools.set(tool.name, {
          tool,
          source: this.inferToolSource(tool.name, serverNames),
          policy,
        });
      }
      this.logger.log(
        'Connected to MCP servers; exposed ' +
          this.tools.size +
          ' of ' +
          loadedTools.length +
          ' tools with explicit policies.',
      );
      for (const [name, record] of this.tools) {
        this.logger.log(
          `Loaded MCP tool: "${name}" - ${record.tool.description?.slice(0, 80)}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to initialize MCP client: ${(err as Error).message}`,
      );
      const failedClient = this.mcpClient;
      this.mcpClient = null;
      this.tools.clear();
      if (failedClient) {
        try {
          await failedClient.close();
          this.logger.log(
            'Closed MCP connections after initialization failure.',
          );
        } catch (closeError) {
          this.logger.error(
            `Failed to close MCP connections after initialization failure: ${(closeError as Error).message}`,
          );
        }
      }
    }
  }

  getMcpTools(tenantId?: string): McpToolView[] {
    const hasTenantContext = Boolean(tenantId?.trim());
    return [...this.tools]
      .filter(
        ([, record]) =>
          record.policy.tenantScope === 'global' ||
          (record.policy.tenantScope === 'tenant' && hasTenantContext),
      )
      .map(([name, record]) => ({
        name,
        description: record.tool.description,
        schema: record.tool.schema,
        source: record.source,
        policy: record.policy,
      }));
  }

  getToolPolicy(name: string): ToolRegistryEntry | undefined {
    return this.tools.get(name)?.policy;
  }

  hasAgentTool(name: string, tenantId?: string): boolean {
    const record = this.tools.get(name);
    return Boolean(
      record &&
      (record.policy.tenantScope === 'global' ||
        (record.policy.tenantScope === 'tenant' && tenantId?.trim())) &&
      (record.policy.tenantScope !== 'tenant' ||
        this.toolAcceptsTenantId(record.tool)),
    );
  }

  async invokeTool(
    name: string,
    input: unknown,
    signal?: AbortSignal,
    tenantId?: string,
  ): Promise<unknown> {
    const record = this.tools.get(name);
    if (!record || !this.mcpClient) {
      throw new Error(`MCP 工具 ${name} 未注册或当前不可用。`);
    }
    if (signal?.aborted) {
      throw signal.reason ?? new Error(`MCP 工具 ${name} 已取消。`);
    }
    let toolInput = input;
    if (record.policy.tenantScope === 'tenant') {
      const trustedTenantId = tenantId?.trim();
      if (!trustedTenantId) {
        throw new Error(`MCP 工具 ${name} 需要可信 tenantId。`);
      }
      if (!this.toolAcceptsTenantId(record.tool)) {
        throw new Error(
          `MCP 工具 ${name} 未声明 tenantId 输入字段，按默认拒绝策略阻断。`,
        );
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`MCP 工具 ${name} 输入必须是对象。`);
      }
      // 模型传入的 tenantId 不可信，始终由服务端上下文覆盖。
      toolInput = {
        ...(input as Record<string, unknown>),
        tenantId: trustedTenantId,
      };
    }
    return record.tool.invoke(toolInput, signal ? { signal } : undefined);
  }

  private parseToolPolicies(value: unknown): Map<string, ToolRegistryEntry> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return new Map();
    }

    const modes = new Set(['simple', 'auto', 'agentic', 'production']);
    const permissions = new Set(['read', 'write', 'external_read']);
    const risks = new Set(['low', 'medium', 'high']);
    const tenantScopes = new Set(['global', 'tenant']);
    const policies = new Map<string, ToolRegistryEntry>();
    for (const [name, rawPolicy] of Object.entries(value)) {
      if (
        !rawPolicy ||
        typeof rawPolicy !== 'object' ||
        Array.isArray(rawPolicy)
      ) {
        this.logger.warn(
          'MCP tool policy "' + name + '" is invalid and was ignored.',
        );
        continue;
      }
      const policy = rawPolicy as Record<string, unknown>;
      const policyModes = policy.modes;
      const validModes =
        Array.isArray(policyModes) &&
        policyModes.length > 0 &&
        policyModes.every(
          (mode) => typeof mode === 'string' && modes.has(mode),
        );
      const validTimeout =
        typeof policy.timeoutMs === 'number' &&
        Number.isInteger(policy.timeoutMs) &&
        policy.timeoutMs > 0 &&
        policy.timeoutMs <= 300_000;
      const validPermission =
        typeof policy.permission === 'string' &&
        permissions.has(policy.permission);
      const validRisk =
        typeof policy.risk === 'string' && risks.has(policy.risk);
      const validTenantScope =
        typeof policy.tenantScope === 'string' &&
        tenantScopes.has(policy.tenantScope);
      const requiresApproval =
        typeof policy.requiresApproval === 'boolean'
          ? policy.requiresApproval
          : undefined;
      const validApproval =
        requiresApproval !== undefined &&
        !(
          (policy.permission === 'write' || policy.risk === 'high') &&
          !requiresApproval
        );
      if (
        !name.startsWith('mcp__') ||
        !validPermission ||
        !validRisk ||
        !validTenantScope ||
        !validApproval ||
        !validModes ||
        !validTimeout
      ) {
        this.logger.warn(
          'MCP tool policy "' +
            name +
            '" is incomplete or invalid and was ignored.',
        );
        continue;
      }

      const serverName = name.split('__')[1] ?? 'unknown';
      policies.set(name, {
        name,
        source: 'mcp',
        permission: policy.permission as ToolRegistryEntry['permission'],
        risk: policy.risk as ToolRegistryEntry['risk'],
        tenantScope: policy.tenantScope as ToolRegistryEntry['tenantScope'],
        requiresApproval,
        modes: [...new Set(policyModes)] as ToolRegistryEntry['modes'],
        timeoutMs: policy.timeoutMs as number,
        audit: true,
        fallback: 'MCP 工具不可用或执行失败，按失败关闭处理。',
        owner: 'mcp:' + serverName,
      });
    }
    return policies;
  }

  private toolAcceptsTenantId(tool: DynamicStructuredTool): boolean {
    const schema = tool.schema as { shape?: Record<string, unknown> };
    return Boolean(
      schema.shape &&
      Object.prototype.hasOwnProperty.call(schema.shape, 'tenantId'),
    );
  }

  private inferToolSource(name: string, serverNames: string[]): string {
    const serverName = [...serverNames]
      .sort((left, right) => right.length - left.length)
      .find((item) => name.startsWith('mcp__' + item + '__'));
    return serverName ? 'mcp:' + serverName : 'mcp:unknown';
  }

  async onModuleDestroy() {
    if (this.mcpClient) {
      this.logger.log('Closing MCP connections...');
      try {
        await this.mcpClient.close();
        this.logger.log('MCP connections closed successfully.');
      } catch (err) {
        this.logger.error(
          `Failed to close MCP client: ${(err as Error).message}`,
        );
      }
    }
  }
}
