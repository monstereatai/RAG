export interface SkillMetadata {
  name: string;
  description: string;
  sourcePath: string;
  tags: string[];
  content: string;
}

export interface SkillMatch extends SkillMetadata {
  score: number;
  matchedTerms: string[];
  matchMode: 'embedding' | 'token';
  semanticScore?: number;
}
