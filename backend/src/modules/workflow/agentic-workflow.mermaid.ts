import type { SseEventType } from '../../rag/agentic/sse-event';

interface WorkflowNode {
  id: string;
  label: string;
}

interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MermaidWorkflowResult {
  diagram: string;
  highlightedNodes: string[];
}

const nodes: WorkflowNode[] = [
  { id: 'start', label: 'START' },
  { id: 'queryAugment', label: 'Query Augment' },
  { id: 'retrieval', label: 'Retrieval' },
  { id: 'sufficiency', label: 'Sufficiency Check' },
  { id: 'webSearchFallback', label: 'Web Search Fallback' },
  { id: 'rerank', label: 'Rerank' },
  { id: 'generate', label: 'Generate Answer' },
  { id: 'reflection', label: 'Reflection' },
  { id: 'end', label: 'END' },
];

const edges: WorkflowEdge[] = [
  { from: 'start', to: 'queryAugment' },
  { from: 'queryAugment', to: 'retrieval' },
  { from: 'retrieval', to: 'sufficiency' },
  { from: 'sufficiency', to: 'rerank', label: 'sufficient' },
  { from: 'sufficiency', to: 'webSearchFallback', label: 'insufficient' },
  { from: 'webSearchFallback', to: 'rerank' },
  { from: 'rerank', to: 'generate' },
  { from: 'generate', to: 'reflection' },
  { from: 'reflection', to: 'retrieval', label: 'retry' },
  { from: 'reflection', to: 'end', label: 'passed / max retry' },
];

const eventToNode: Partial<Record<SseEventType, string>> = {
  query_augment: 'queryAugment',
  retrieval: 'retrieval',
  sufficiency: 'sufficiency',
  web_search: 'webSearchFallback',
  rerank: 'rerank',
  token: 'generate',
  citation: 'generate',
  reflection: 'reflection',
  final: 'end',
  error: 'end',
};

export function buildAgenticWorkflowMermaid(
  events: SseEventType[] = [],
): MermaidWorkflowResult {
  const highlightedNodes = [
    ...new Set(events.map((event) => eventToNode[event]).filter(Boolean)),
  ] as string[];
  const lines = ['flowchart TD'];

  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}"]`);
  }

  for (const edge of edges) {
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }

  if (highlightedNodes.length > 0) {
    lines.push(
      '  classDef active fill:#e6f7ff,stroke:#1890ff,stroke-width:2px;',
    );
    lines.push(`  class ${highlightedNodes.join(',')} active;`);
  }

  return {
    diagram: lines.join('\n'),
    highlightedNodes,
  };
}

export function parseSseEventTypes(rawEvents?: string): SseEventType[] {
  if (!rawEvents) {
    return [];
  }

  return rawEvents
    .split(',')
    .map((event) => event.trim())
    .filter((event): event is SseEventType =>
      Boolean(eventToNode[event as SseEventType]),
    );
}
