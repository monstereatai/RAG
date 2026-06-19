/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-call */

import { ConfigService } from '@nestjs/config';
import { McpProvider } from './mcp.provider';
import * as fs from 'node:fs';

// Mock node:fs
jest.mock('node:fs', () => {
  return {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

// Mock MultiServerMCPClient
jest.mock('@langchain/mcp-adapters', () => {
  return {
    MultiServerMCPClient: jest.fn().mockImplementation(() => {
      return {
        getTools: jest
          .fn()
          .mockResolvedValue([
            { name: 'mcp-tool-1', description: 'MCP Tool description' },
          ]),
        close: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe('McpProvider', () => {
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    };
    jest.clearAllMocks();
  });

  it('keeps MCP disabled unless explicitly enabled', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'mcp.enabled') return false;
      return undefined;
    });

    const provider = new McpProvider(mockConfigService as ConfigService);
    await provider.onModuleInit();

    expect(provider.getMcpTools()).toEqual([]);
  });

  it('handles missing config file gracefully when enabled', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'mcp.enabled') return true;
      if (key === 'mcp.configPath') return '/path/to/missing.yaml';
      return undefined;
    });
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const provider = new McpProvider(mockConfigService as ConfigService);
    await provider.onModuleInit();

    expect(provider.getMcpTools()).toEqual([]);
  });

  it('handles empty config file gracefully', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'mcp.enabled') return true;
      if (key === 'mcp.configPath') return '/path/to/empty.yaml';
      return undefined;
    });
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('');

    const provider = new McpProvider(mockConfigService as ConfigService);
    await provider.onModuleInit();

    expect(provider.getMcpTools()).toEqual([]);
  });

  it('successfully initializes servers and loads tools when configured', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'mcp.enabled') return true;
      if (key === 'mcp.configPath') return '/path/to/servers.yaml';
      return undefined;
    });
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(
      'mcpServers:\n  server1:\n    command: node',
    );

    const provider = new McpProvider(mockConfigService as ConfigService);
    await provider.onModuleInit();

    expect(provider.getMcpTools()).toEqual([
      { name: 'mcp-tool-1', description: 'MCP Tool description' },
    ]);

    await provider.onModuleDestroy();
  });
});
