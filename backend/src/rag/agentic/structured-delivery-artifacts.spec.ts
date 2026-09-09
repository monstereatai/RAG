import { buildStructuredDeliveryArtifacts } from './structured-delivery-artifacts';

describe('structured delivery artifacts', () => {
  it('creates the game marketing delivery chain without inventing business facts', () => {
    const artifacts = buildStructuredDeliveryArtifacts(
      '为海外新角色抽奖 H5 输出页面、接口、埋点和验收方案',
      [
        {
          id: 'chunk-1',
          content: '抽奖页需要概率公示、中奖记录和 draw_button_click 埋点。',
          docId: 'game-template-1',
          chunkIndex: 0,
          bm25Score: 0.8,
          cosineScore: 0.9,
          totalScore: 0.88,
        },
      ],
      '基于证据生成方案初稿。',
      true,
    );

    expect(artifacts).toHaveLength(11);
    expect(artifacts.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        'requirement_brief',
        'claim_evidence_matrix',
        'api_contract',
        'event_tracking_plan',
        'test_plan',
        'acceptance_checklist',
        'risk_register',
        'code_context_pack',
      ]),
    );
    const assumptions = artifacts.find(
      (item) => item.type === 'assumption_register',
    );
    expect(JSON.stringify(assumptions?.payload)).toContain('待产品确认');
    const tracking = artifacts.find(
      (item) => item.type === 'event_tracking_plan',
    );
    expect(JSON.stringify(tracking?.payload)).toContain('draw_button_click');
  });

  it('marks model fallback delivery as requiring confirmation', () => {
    const [solution] = buildStructuredDeliveryArtifacts(
      '设计活动方案',
      [],
      '没有可验证的业务证据。',
      false,
    );

    expect(JSON.stringify(solution.payload)).toContain('needs_confirmation');
    expect(JSON.stringify(solution.payload)).toContain('预算');
    expect(JSON.stringify(solution.payload)).toContain('model_fallback');
  });
});
