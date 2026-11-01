import { ContextBuilder, retrievalProfileForTaskType } from './context-builder';
import type { RetrievedChunk } from '../evidence/retrieval.types';

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id:'hit-1', docId:'doc-1',chunkIndex:0,bm25Score:1,cosineScore:1,totalScore:1,
    content:'具体活动规则：完成任务才有奖励', parentChunkId:'parent-1',
    parentContent:'活动玩法背景。\n具体活动规则：完成任务才有奖励\n本活动仅适用国服。',
    sourceMetadata: JSON.stringify({filename:'活动规则.pdf',pageNumber:3}),
    ...overrides,
  };
}

describe('hybrid retrieval context expansion', () => {
  it('expands bounded parent context for generation without swapping evidence identity', () => {
    const result = new ContextBuilder().build([chunk()], retrievalProfileForTaskType('synthesis'));
    expect(result.chunks[0].id).toBe('hit-1');
    expect(result.chunks[0].content).toContain('本活动仅适用国服');
    expect(result.chunks[0].citationLabel).toContain('第 3 页');
    expect(result.context).toContain('活动规则.pdf');
  });
  it('keeps precise child-only context on lookup', () => {
    const result = new ContextBuilder().build([chunk()], retrievalProfileForTaskType('lookup'));
    expect(result.chunks[0].content).toBe('具体活动规则：完成任务才有奖励');
  });
  it('rejects malicious or malformed provenance without fabricating citations', () => {
    const result = new ContextBuilder().build([chunk({sourceMetadata:'not json'})], retrievalProfileForTaskType('lookup'));
    expect(result.chunks[0].citationLabel).toBeUndefined();
  });
});
