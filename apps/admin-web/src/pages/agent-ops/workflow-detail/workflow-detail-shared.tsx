import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Select } from 'antd';
import type {
  ProductionArtifactTarget,
  ProductionRole,
  ProductionWorkflow,
} from '../service';

export const ROLE_LABELS: Record<ProductionRole, string> = {
  product: '产品',
  design: '设计',
  frontend: '前端',
  backend: '后端',
  qa: '测试',
  operations: '运营',
};

export const STATUS_LABELS: Record<ProductionWorkflow['status'], string> = {
  running: '运行中',
  pending_approval: '待审批',
  revision_required: '待修订',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export const ARTIFACT_OPTIONS: Array<{
  value: ProductionArtifactTarget;
  label: string;
}> = [
  { value: 'activity-schema', label: '活动页 Schema JSON（内部结构）' },
  { value: 'vue-page', label: 'Vue 活动页代码' },
  { value: 'react-page', label: 'React 活动页代码' },
  { value: 'dashboard-schema', label: '数字大屏 Schema' },
  { value: 'vue-dashboard', label: 'Vue 数字大屏代码' },
  { value: 'react-dashboard', label: 'React 数字大屏代码' },
  { value: 'nestjs-api', label: 'NestJS 后端 API 项目 ZIP' },
];

export const artifactLabel = (target: unknown) =>
  ARTIFACT_OPTIONS.find((option) => option.value === target)?.label ??
  String(target ?? '未知产物');

export interface ProductionArtifactEditDraft {
  target: 'activity-schema' | 'dashboard-schema';
  baseArtifactId: string;
  schema: Record<string, unknown>;
  diff: Array<{ path: string; before?: unknown; after?: unknown }>;
}

export interface ProductionCodeEditDraft {
  baseArtifactId: string;
  instruction: string;
  target: Exclude<ProductionArtifactTarget, 'activity-schema' | 'dashboard-schema' | 'nestjs-api'>;
  framework: 'vue' | 'react';
  files: Record<string, string>;
  diff: Array<{ path: string; before: string; after: string }>;
  previewHtml: string;
}

export type ProductionCodingTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'budget_exceeded'
  | 'cancelled'
  | 'verification_failed'
  | 'waiting_review'
  | 'waiting_reconciliation';

export interface ProductionCodingTask {
  taskId: string;
  runId: string | null;
  traceId?: string | null;
  threadId: string;
  role?: 'frontend' | 'backend' | 'qa';
  taskType?: 'code' | 'verify';
  artifactId?: string;
  parentRunId?: string | null;
  outputArtifactId?: string | null;
  status: ProductionCodingTaskStatus;
  attempt: number;
  lastCompletedStep: number;
  summary: string | null;
  error: string | null;
  failureReason?: string | null;
  verification?: ProductionCodingVerification | ProductionQAReport | null;
  events: Array<{
    sequence: number;
    eventType: string;
    createdAt: string;
    payload: unknown;
  }>;
  updatedAt: string;
  createdAt?: string;
}

export interface ProductionCodingVerification {
    checkedAt: string;
    diff: {
      added: Array<{ path: string; sha256: string }>;
      modified: Array<{
        path: string;
        seedSha256: string;
        workspaceSha256: string;
      }>;
      deleted: Array<{ path: string; sha256: string }>;
    };
    checks: Record<
      'lint' | 'test' | 'build',
      {
        status: 'passed' | 'failed' | 'not_applicable' | 'not_run';
        command: string | null;
        exitCode: number | null;
        output: string;
        reason?: string;
      }
    >;
}

export interface ProductionQAReport {
  artifactId: string;
  artifactVersion: string;
  checks: Array<{
    name: 'lint' | 'test' | 'build';
    status: 'passed' | 'failed' | 'not_applicable' | 'not_run';
    exitCode: number | null;
    summary: string;
    logRef: string | null;
  }>;
  diagnosis: string;
  evidenceRefs: string[];
  suggestedFixes: string[];
  requiresHumanReview: true;
  status: 'passed' | 'failed' | 'not_run';
  summary: string;
  parentRunId: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionWorkspaceCommandResult {
  exitCode: number;
  output: string;
}

export const normalizeMarkdown = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, '```$1\n');

export function SelectRoles({
  roles,
  value,
  onChange,
}: {
  roles: ProductionRole[];
  value?: ProductionRole[];
  onChange?: (value: ProductionRole[]) => void;
}) {
  return (
    <Select
      mode="multiple"
      value={value}
      onChange={onChange}
      options={roles.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
      placeholder="选择需要重跑的岗位"
    />
  );
}

export function SpaceButtons({
  onBack,
  onRefresh,
  loading,
}: {
  onBack: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <span>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
        返回列表
      </Button>
      <Button
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={onRefresh}
        style={{ marginLeft: 8 }}
      >
        刷新
      </Button>
    </span>
  );
}
