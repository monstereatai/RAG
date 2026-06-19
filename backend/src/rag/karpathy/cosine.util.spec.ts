import { cosineSimilarity } from './cosine.util';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 when one vector has zero norm', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('throws for dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow(
      'Vector dimension mismatch: 2 vs 1',
    );
  });
});
