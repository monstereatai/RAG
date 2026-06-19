export type JobType = 'cron' | 'every' | 'at';

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
  cron?: string;
  everyMs?: number;
  at?: string;
  enabled?: boolean;
}
