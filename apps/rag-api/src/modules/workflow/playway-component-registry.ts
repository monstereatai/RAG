import {
  ACTIVITY_LABELS,
  PLAYWAY_ACTIVITY_TEMPLATES,
  PLAYWAY_COMPONENT_RULES,
} from './playway-component-data';
import type {
  PlaywayActivityGraph,
  PlaywayActivityTemplate,
  PlaywayComponentRule,
} from './playway-component-data';
export {
  PLAYWAY_ACTIVITY_TEMPLATES,
  PLAYWAY_COMPONENT_RULES,
  PLAYWAY_COMPONENT_TYPES,
} from './playway-component-data';
export type {
  PlaywayActivity,
  PlaywayActivityGraph,
  PlaywayActivityTemplate,
  PlaywayComponentRule,
  PlaywayRuleRisk,
} from './playway-component-data';

const normalize = (value: string) => value.toLowerCase().trim();

const compact = (value: string) => normalize(value).replace(/\s+/g, '');

export function searchPlaywayComponents(
  query: string,
  limit = 18,
): PlaywayComponentRule[] {
  const terms = normalize(query)
    .split(/[，。！？、\s,!?/]+/)
    .filter(Boolean);
  if (terms.length === 0) return PLAYWAY_COMPONENT_RULES.slice(0, limit);
  return PLAYWAY_COMPONENT_RULES.map((item) => ({
    item,
    score: terms.reduce((score, term) => {
      const haystack = compact(
        `${item.type}${item.displayName}${item.category}${item.description}${item.keywords.join('')}${item.activities.flatMap((activity) => ACTIVITY_LABELS[activity]).join('')}`,
      );
      return score + (haystack.includes(compact(term)) ? 2 : 0);
    }, 0),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.type.localeCompare(b.item.type))
    .slice(0, limit)
    .map(({ item }) => item);
}

export function formatPlaywayRulesForPrompt(query: string): string {
  return searchPlaywayComponents(query)
    .map(
      (item) =>
        `${item.type}|${item.displayName}|需:${item.requires.join(',')}|配置:${item.configFields.join(',')}|事件:${item.emits.join(',')}|风险:${item.risk}|适用:${item.activities.join(',')}`,
    )
    .join('\n');
}

export function getPlaywayComponentRule(
  type: string,
): PlaywayComponentRule | undefined {
  return PLAYWAY_COMPONENT_RULES.find((item) => item.type === type);
}

export function searchPlaywayActivityTemplates(
  query: string,
  limit = 4,
): PlaywayActivityTemplate[] {
  const normalized = compact(query);
  if (!normalized) return PLAYWAY_ACTIVITY_TEMPLATES.slice(0, limit);
  return PLAYWAY_ACTIVITY_TEMPLATES.map((template) => ({
    template,
    score: [
      template.name,
      template.goal,
      template.activity,
      ...template.requiredComponents,
      ...template.optionalComponents,
      ...template.acceptanceChecks,
    ].reduce(
      (score, value) => score + (compact(value).includes(normalized) ? 2 : 0),
      0,
    ),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ template }) => template);
}

export function formatPlaywayTemplatesForPrompt(query: string): string {
  return searchPlaywayActivityTemplates(query)
    .map(
      (template) =>
        `${template.id}|${template.name}|必选:${template.requiredComponents.join(',')}|可选:${template.optionalComponents.join(',')}|接口:${template.requiredApis.join(',')}|埋点:${template.requiredEvents.join(',')}|验收:${template.acceptanceChecks.join('；')}`,
    )
    .join('\n');
}

export function buildPlaywayActivityGraph(query = ''): PlaywayActivityGraph {
  const templates = searchPlaywayActivityTemplates(query, 4);
  const nodes = new Map<string, { id: string; type: string; label: string }>();
  const edges: PlaywayActivityGraph['edges'] = [];
  const addNode = (id: string, type: string, label: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label });
  };
  for (const template of templates) {
    const activityId = `activity:${template.activity}`;
    addNode(activityId, 'activity', template.name);
    for (const componentType of [
      ...template.requiredComponents,
      ...template.optionalComponents,
    ]) {
      const rule = getPlaywayComponentRule(componentType);
      if (!rule) continue;
      const componentId = `component:${rule.type}`;
      addNode(componentId, 'component', rule.displayName);
      edges.push({ source: activityId, target: componentId, relation: 'uses' });
    }
    for (const api of template.requiredApis) {
      const apiId = `api:${api}`;
      addNode(apiId, 'api', api);
      edges.push({
        source: activityId,
        target: apiId,
        relation: 'requires_api',
      });
    }
    for (const event of template.requiredEvents) {
      const eventId = `event:${event}`;
      addNode(eventId, 'event', event);
      edges.push({ source: activityId, target: eventId, relation: 'tracks' });
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: edges.filter(
      (edge, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.source === edge.source &&
            candidate.target === edge.target &&
            candidate.relation === edge.relation,
        ) === index,
    ),
  };
}
