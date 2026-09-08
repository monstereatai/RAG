import {
  PLAYWAY_COMPONENT_RULES,
  PLAYWAY_ACTIVITY_TEMPLATES,
  buildPlaywayActivityGraph,
  searchPlaywayActivityTemplates,
  searchPlaywayComponents,
} from './playway-component-registry';
import { renderPlaywayPreview } from './playway-preview';

describe('playway component registry', () => {
  it('covers every registered component with a usable rule', () => {
    expect(PLAYWAY_COMPONENT_RULES).toHaveLength(96);
    expect(new Set(PLAYWAY_COMPONENT_RULES.map((item) => item.type)).size).toBe(
      96,
    );
    for (const item of PLAYWAY_COMPONENT_RULES) {
      expect(item.displayName).toBeTruthy();
      expect(item.emits.length).toBeGreaterThan(0);
    }
  });

  it('retrieves rules by activity language and component intent', () => {
    const result = searchPlaywayComponents('新服预约 抽卡 开服时间');
    expect(result.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        'reserve-card-draw',
        'reserve-draw-count',
        'server-open-time',
      ]),
    );
  });

  it('retrieves activity templates from Chinese activity labels', () => {
    expect(searchPlaywayComponents('私域拉新').length).toBeGreaterThan(0);
    expect(searchPlaywayComponents('游戏回流').length).toBeGreaterThan(0);
    expect(searchPlaywayComponents('游戏促活').length).toBeGreaterThan(0);
  });

  it('keeps activity templates referentially closed over registered components', () => {
    const known = new Set(PLAYWAY_COMPONENT_RULES.map((item) => item.type));
    expect(PLAYWAY_ACTIVITY_TEMPLATES).toHaveLength(4);
    for (const template of PLAYWAY_ACTIVITY_TEMPLATES) {
      expect(
        [...template.requiredComponents, ...template.optionalComponents].every(
          (type) => known.has(type),
        ),
      ).toBe(true);
      expect(searchPlaywayActivityTemplates(template.name)).toContainEqual(
        template,
      );
    }
  });

  it('builds a deduplicated activity graph for downstream GraphRAG and MCP use', () => {
    const graph = buildPlaywayActivityGraph('新服预约');
    expect(graph.nodes.some((node) => node.type === 'activity')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'component:reserve-now')).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.type === 'api')).toBe(true);
    expect(graph.nodes.some((node) => node.type === 'event')).toBe(true);
    expect(new Set(graph.edges.map((edge) => `${edge.source}|${edge.target}|${edge.relation}`)).size).toBe(
      graph.edges.length,
    );
  });

  it('renders a safe deterministic page preview from pageSchema', () => {
    const preview = renderPlaywayPreview([
      {
        schemaVersion: 1,
        role: 'frontend',
        kind: 'pageSchema',
        title: '预览',
        source: 'fallback',
        components: [
          { id: 'hero', type: 'banner', name: '<活动主视觉>' },
          { id: 'cta', type: 'reserve-now', name: '立即预约' },
        ],
      },
    ]);
    expect(preview.componentTypes).toEqual(['banner', 'reserve-now']);
    expect(preview.html).toContain('&lt;活动主视觉&gt;');
    expect(preview.html).not.toContain('<活动主视觉>');
  });

  it('prefers a non-empty pageSchema when an earlier role returned an empty schema', () => {
    const preview = renderPlaywayPreview([
      {
        schemaVersion: 1,
        role: 'product',
        kind: 'pageSchema',
        title: '产品审查占位',
        source: 'llm',
        components: [],
      },
      {
        schemaVersion: 1,
        role: 'design',
        kind: 'pageSchema',
        title: '设计页面结构',
        source: 'fallback',
        components: [{ id: 'wheel', type: 'wheel', name: '抽奖转盘' }],
      },
    ]);
    expect(preview.componentTypes).toEqual(['wheel']);
    expect(preview.html).toContain('抽奖转盘');
  });
});
