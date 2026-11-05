import { describe, expect, it } from 'vitest';
import { previewProductionWorkflow } from './agent-ops-workflow-panel';

describe('production workflow launch preview', () => {
  const roles = ['product', 'design', 'backend', 'frontend'] as const;

  it('shows the same hierarchical dependency layers as the backend', () => {
    const preview = previewProductionWorkflow([...roles], 'hierarchical', 'auto', [], 'high');
    expect(preview.batches).toEqual([
      ['product'],
      ['design', 'backend'],
      ['frontend'],
    ]);
    expect(preview.approval).toContain('生成失败或证据不足时暂停');
  });

  it('shows the configured manual approval conditions', () => {
    const preview = previewProductionWorkflow([...roles], 'sequential', 'risk_based', ['design'], 'medium');
    expect(preview.batches).toEqual(roles.map((role) => [role]));
    expect(preview.approval).toContain('中、高风险岗位需人工审批');
    expect(preview.approval).toContain('指定岗位：设计');
  });
});
