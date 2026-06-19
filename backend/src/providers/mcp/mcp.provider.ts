import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  MultiServerMCPClient,
  type ClientConfig,
} from '@langchain/mcp-adapters';

interface McpTool {
  name: string;
  description?: string;
}

@Injectable()
export class McpProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpProvider.name);
  private mcpClient: MultiServerMCPClient | null = null;
  private tools: McpTool[] = [];

  async onModuleInit() {
    const configPath = path.resolve(
      process.cwd(),
      '../workspace/mcp-servers.yaml',
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

      this.mcpClient = new MultiServerMCPClient({
        mcpServers: config.mcpServers,
      });

      // Fetch tools to verify connection and cache them
      this.tools = (await this.mcpClient.getTools()) as McpTool[];
      this.logger.log(
        `Successfully connected and loaded ${this.tools.length} MCP tools.`,
      );
      for (const tool of this.tools) {
        this.logger.log(
          `Loaded MCP tool: "${tool.name}" - ${tool.description?.slice(0, 80)}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to initialize MCP client: ${(err as Error).message}`,
      );
      this.mcpClient = null;
      this.tools = [];
    }
  }

  getMcpTools(): McpTool[] {
    return this.tools;
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
