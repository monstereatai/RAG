export type BadCaseMatchMode = 'hint' | 'correction' | 'exact';

export interface BadCaseMatch {
  id: string;
  query: string;
  text: string;
  score: number;
  mode: BadCaseMatchMode;
}
