import { ConfigService } from '@nestjs/config';
import { McpProvider } from './mcp.provider';

describe('McpProvider', () => {
  it('keeps MCP disabled unless explicitly enabled', async () => {
    const provider = new McpProvider({
      get: (key: string) => (key === 'mcp.enabled' ? false : undefined),
    } as ConfigService);

    await provider.onModuleInit();

    expect(provider.getMcpTools()).toEqual([]);
  });
});
