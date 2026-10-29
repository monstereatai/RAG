export interface ObsidianSearchHit {
  path: string;
  type: 'compiled' | 'index' | 'note';
  isSourceNote?: boolean;
  title: string;
  content: string;
  score: number;
  ragDocId?: string;
  sourceUrl?: string;
  tags: string[];
}
