import { PluginRuntimeService } from './plugin-runtime.service';

describe('PluginRuntimeService', () => {
  const createService = () => {
    const repo = { find: jest.fn().mockResolvedValue([]) };
    return new PluginRuntimeService(repo as never);
  };

  it('combines built-in production plugins into one effective tool allowlist', async () => {
    const resolved = await createService().resolve(
      ['workflow.production-base', 'coding.mcp-context'],
      'production',
    );

    expect(resolved.pluginKeys).toEqual([
      'workflow.production-base',
      'coding.mcp-context',
    ]);
    expect(resolved.toolNames).toEqual(
      expect.arrayContaining([
        'product_knowledge_search',
        'artifact_generate',
        'mcp_tools',
      ]),
    );
  });

  it('rejects plugins outside the requested execution mode', async () => {
    await expect(
      createService().resolve(['rag.web-research'], 'production'),
    ).rejects.toThrow('不支持 production 链路');
  });
});
