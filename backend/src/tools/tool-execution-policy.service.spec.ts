import { ToolExecutionPolicyService } from './tool-execution-policy.service';

describe('ToolExecutionPolicyService', () => {
  const service = new ToolExecutionPolicyService();

  it('fails closed for an unregistered tool', () => {
    expect(service.decide('unknown_tool', { mode: 'agentic' })).toMatchObject({
      allowed: false,
    });
  });

  it('enforces the production role allowlist', () => {
    expect(
      service.decide('frontend_engineering_search', {
        mode: 'production',
        role: 'frontend',
      }),
    ).toMatchObject({ allowed: true });
    expect(
      service.decide('frontend_engineering_search', {
        mode: 'production',
        role: 'backend',
      }),
    ).toMatchObject({ allowed: false });
  });

  it('does not allow network search in Simple mode', () => {
    expect(service.decide('bocha_web_search', { mode: 'simple' })).toMatchObject({
      allowed: false,
    });
  });

  it('enforces the resolved plugin tool allowlist when one is supplied', () => {
    expect(service.decide('artifact_generate', {
      mode: 'production',
      role: 'product',
      pluginKeys: ['workflow.readonly-review'],
      allowedToolNames: ['product_knowledge_search'],
    })).toMatchObject({ allowed: false });
  });
});
