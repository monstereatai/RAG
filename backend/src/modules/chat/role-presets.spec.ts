import { BadRequestException } from '@nestjs/common';
import {
  buildRoleSystemMessage,
  canonicalizeRole,
  listRolePresets,
  resolveRoleContext,
  resolveRolePreset,
} from './role-presets';

describe('role presets', () => {
  it('uses business owner as the default full-chain role', () => {
    const context = resolveRoleContext();

    expect(context.preset.id).toBe('business-owner');
    expect(context.role).toBeUndefined();
    expect(context.systemMessage).toContain('业务负责人');
    expect(context.systemMessage).toContain('全流程');
  });

  it('provides usable tasks and questions for every role', () => {
    for (const preset of listRolePresets()) {
      expect(preset.starterTasks.length).toBeGreaterThanOrEqual(3);
      expect(preset.suggestedQuestions.length).toBeGreaterThanOrEqual(3);
      expect(buildRoleSystemMessage(preset)).toContain(preset.name);
    }
  });

  it('normalizes common Chinese and English role aliases', () => {
    expect(canonicalizeRole('PM')).toBe('product-manager');
    expect(canonicalizeRole('产品经理')).toBe('product-manager');
    expect(canonicalizeRole('QA')).toBe('qa-engineer');
    expect(canonicalizeRole('前端开发')).toBe('frontend-engineer');
  });

  it('keeps an explicitly selected retrieval role', () => {
    const context = resolveRoleContext('ui-designer', 'external-reviewer');
    expect(context.role).toBe('external-reviewer');
  });

  it('rejects an unknown preset instead of silently changing behavior', () => {
    expect(() => resolveRolePreset('unknown')).toThrow(BadRequestException);
  });
});
