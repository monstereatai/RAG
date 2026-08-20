import {
  PRODUCTION_ROLE_TOOL_POLICIES,
  ProductionWorkflowTools,
} from './production-workflow.tools';

describe('ProductionWorkflowTools', () => {
  it('uses a role-specific allowlisted search tool', async () => {
    const retrieveDetailed = jest.fn().mockResolvedValue({
      chunks: [
        {
          id: 'chunk-1',
          docId: 'doc-1',
          chunkIndex: 2,
          content: '前端埋点必须包含 activity_id。',
          totalScore: 0.9,
        },
      ],
    });
    const service = new ProductionWorkflowTools(
      { retrieveDetailed } as never,
      { decide: jest.fn().mockReturnValue({ allowed: true }) } as never,
      { execute: jest.fn().mockImplementation(async (input) => ({ status: 'success', output: await input.execute(), durationMs: 1 })) } as never,
    );

    const result = await service.gather('frontend', {
      projectId: 'project-1',
      brief: '检查活动页面埋点方案',
      userId: 'user-1',
    });

    expect(result.executions[0].tool).toBe('frontend_engineering_search');
    expect(result.executions[0].status).toBe('success');
    expect(result.evidence[0].id).toBe('chunk-1');
    expect(PRODUCTION_ROLE_TOOL_POLICIES.frontend.maxCalls).toBe(1);
  });

  it('degrades without inventing evidence when retrieval fails', async () => {
    const service = new ProductionWorkflowTools(
      { retrieveDetailed: () => Promise.reject(new Error('milvus timeout')) } as never,
      { decide: jest.fn().mockReturnValue({ allowed: true }) } as never,
      { execute: jest.fn().mockImplementation(async (input) => ({ status: 'success', output: await input.execute(), durationMs: 1 })) } as never,
    );

    const result = await service.gather('backend', {
      projectId: 'project-1',
      brief: '检查发奖补偿方案',
      userId: 'user-1',
    });

    expect(result.evidence).toEqual([]);
    expect(result.executions[0]).toMatchObject({
      tool: 'backend_contract_search',
      status: 'failed',
      evidenceCount: 0,
    });
  });
});
