import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { McpProvider } from '../../providers/mcp/mcp.provider';

interface McpToolView {
  name: string;
  description?: string;
  schema?: unknown;
  source?: string;
}

@Controller('mcp')
@UseGuards(JwtAuthGuard)
export class McpController {
  constructor(private readonly mcpProvider: McpProvider) {}

  @Get('tools')
  getTools(): McpToolView[] {
    const tools = this.mcpProvider.getMcpTools();

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      source: tool.source,
    }));
  }
}
