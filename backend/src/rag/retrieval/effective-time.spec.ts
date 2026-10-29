import type { EffectiveTimeRange } from '../evidence/retrieval.types';
import { RetrievalPolicyService } from '../planning/retrieval-policy.service';
import { createFallbackQueryPlan } from '../planning/query-plan';
import {
  isEffectiveDuring,
  parseEffectiveTime,
  scopeForEffectiveTime,
} from './effective-time';

const SEPTEMBER_TO_NOVEMBER: EffectiveTimeRange = {
  from: '2025-09-01T00:00:00.000Z',
  to: '2025-11-01T00:00:00.000Z',
};

describe('effective-time retrieval policy', () => {
  it('parses a spaced Chinese month range as a half-open interval', () => {
    expect(parseEffectiveTime('2025 年 9—10 月有效规则有哪些？')).toEqual(
      SEPTEMBER_TO_NOVEMBER,
    );
  });

  it('uses interval overlap for historical queries and keeps draft or archived files hidden', () => {
    const range = SEPTEMBER_TO_NOVEMBER;

    expect(
      isEffectiveDuring(
        {
          effectiveAt: '2025-09-15T00:00:00.000Z',
          expiredAt: '2025-10-15T00:00:00.000Z',
          lifecycleStatus: 'expired',
        },
        range,
      ),
    ).toBe(true);
    expect(
      isEffectiveDuring(
        {
          effectiveAt: '2025-11-01T00:00:00.000Z',
          lifecycleStatus: 'effective',
        },
        range,
      ),
    ).toBe(false);
    expect(
      isEffectiveDuring(
        {
          effectiveAt: '2025-09-15T00:00:00.000Z',
          lifecycleStatus: 'draft',
        },
        range,
      ),
    ).toBe(false);
    expect(
      isEffectiveDuring(
        {
          effectiveAt: '2025-09-15T00:00:00.000Z',
          lifecycleStatus: 'archived',
        },
        range,
      ),
    ).toBe(false);
  });

  it('keeps ordinary queries on current validity and enables historical deprecated versions', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-10-29T00:00:00Z'));
    try {
      expect(
        isEffectiveDuring({
          effectiveAt: '2025-09-01T00:00:00.000Z',
          expiredAt: '2025-10-01T00:00:00.000Z',
          lifecycleStatus: 'expired',
        }),
      ).toBe(false);
      expect(
        isEffectiveDuring({
          effectiveAt: '2025-09-01T00:00:00.000Z',
          expiredAt: '2025-12-01T00:00:00.000Z',
          lifecycleStatus: 'deprecated',
        }),
      ).toBe(true);

      const historicalScope = scopeForEffectiveTime(
        '2025 年 9—10 月有效规则',
        {},
      );
      expect(historicalScope).toMatchObject({
        effectiveTime: SEPTEMBER_TO_NOVEMBER,
        includeDeprecated: true,
      });
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('turns an explicit historical question into a local-only effective-time scope', () => {
    const query = '2025 年 9—10 月有效规则有哪些？';
    const plan = new RetrievalPolicyService().build(
      query,
      createFallbackQueryPlan(query),
    );

    expect(plan.scope).toMatchObject({
      effectiveTime: SEPTEMBER_TO_NOVEMBER,
      includeDeprecated: true,
    });
    expect(plan.scopeRestricted).toBe(true);
    expect(plan.sourcePolicy).toBe('local_only');
  });
});
