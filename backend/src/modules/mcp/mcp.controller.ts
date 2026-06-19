import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { McpProvider } from '../../providers/mcp/mcp.provider';

@Controller('mcp')
@UseGuards(JwtAuthGuard)
export class McpController {
  constructor(private readonly mcpProvider: McpProvider) {}

  @Get('tools')
  getTools() {
    const tools = this.mcpProvider.getMcpTools();

    return tools.map((tool: any) => ({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      name: tool.name,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      description: tool.description,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      schema: tool.schema,
      source: `mcp:unknown`, // @langchain/mcp-adapters might attach mcp source info, but we'll return a generic mcp source for now if it doesn't
    }));
  }
}
