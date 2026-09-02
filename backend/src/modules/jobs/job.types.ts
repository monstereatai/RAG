export type JobType = 'cron' | 'every' | 'at';
export type ScheduledJobKind = 'agent' | 'analysis';
export type ScheduledJobSourceType = 'natural_language' | 'markdown';
export type AnalysisDataScope = 'rules' | 'complaints' | 'qa' | 'workflow';

export interface ScheduledAnalysisConfig {
  window: 'today' | 'week' | 'month';
  dataScopes: AnalysisDataScope[];
  roles: string[];
  departments: string[];
}

export interface ScheduledJob {
  id: string;
  type: JobType;
  instruction: string;
  enabled: boolean;
  running: boolean;
  cron?: string;
  everyMs?: number;
  at?: string;
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
}

export interface CreateJobInput {
  type: JobType;
  instruction: string;
  name?: string;
  taskKind?: ScheduledJobKind;
  sourceType?: ScheduledJobSourceType;
  analysisConfig?: ScheduledAnalysisConfig;
  cron?: string;
  everyMs?: number;
  at?: string;
  enabled?: boolean;
  userId?: string;
  versionGroupId?: string;
  version?: number;
  isCurrent?: boolean;
  copiedFromId?: string | null;
}

export interface ParsedScheduledAnalysis {
  name: string;
  type: JobType;
  cron?: string;
  everyMs?: number;
  at?: string;
  sourceType: ScheduledJobSourceType;
  instruction: string;
  analysisConfig: ScheduledAnalysisConfig;
}
