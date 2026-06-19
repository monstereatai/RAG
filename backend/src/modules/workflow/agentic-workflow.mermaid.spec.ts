import {
  buildAgenticWorkflowMermaid,
  parseSseEventTypes,
} from './agentic-workflow.mermaid';

describe('agentic workflow Mermaid export', () => {
  it('exports the static Agentic RAG workflow as Mermaid', () => {
    const result = buildAgenticWorkflowMermaid();

    expect(result.highlightedNodes).toEqual([]);
    expect(result.diagram).toContain('flowchart TD');
    expect(result.diagram).toContain('queryAugment["Query Augment"]');
    expect(result.diagram).toContain('reflection -->|retry| retrieval');
    expect(result.diagram).toContain('reflection -->|passed / max retry| end');
  });

  it('highlights nodes from SSE event names', () => {
    const result = buildAgenticWorkflowMermaid([
      'query_augment',
      'retrieval',
      'sufficiency',
      'token',
      'reflection',
      'final',
    ]);

    expect(result.highlightedNodes).toEqual([
      'queryAugment',
      'retrieval',
      'sufficiency',
      'generate',
      'reflection',
      'end',
    ]);
    expect(result.diagram).toContain('classDef active');
    expect(result.diagram).toContain(
      'class queryAugment,retrieval,sufficiency,generate,reflection,end active;',
    );
  });

  it('parses known SSE event names and ignores unknown values', () => {
    expect(parseSseEventTypes('retrieval,unknown,token')).toEqual([
      'retrieval',
      'token',
    ]);
  });
});
