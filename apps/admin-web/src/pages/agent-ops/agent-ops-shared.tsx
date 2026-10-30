import { Card, Collapse, Descriptions } from 'antd';
import type { ProductionRole, ProductionWorkflow } from './service';

export const ROLE_LABELS: Record<ProductionRole, string> = {
  product: '产品',
  design: '设计',
  frontend: '前端',
  backend: '后端',
  qa: '测试',
  operations: '运营',
};

export const METRIC_LABELS: Record<string, string> = {
  faithfulness: '事实有证据支持',
  context_recall: '检索证据命中',
  requirement_coverage: '答案要求覆盖',
  test_case_structure_completeness: '测试用例结构完整',
};

export const ARTIFACT_LABELS: Record<string, string> = {
  subquestion_plan: '子问题计划',
  evidence_bundle: '证据包',
  answer_contract: '答案契约',
  requirement_brief: '需求简报',
  assumption_register: '假设登记',
  claim_evidence_matrix: '声明证据矩阵',
  solution_brief: '方案简报',
  api_contract: '接口契约',
  event_tracking_plan: '埋点方案',
  test_plan: '测试计划',
  acceptance_checklist: '验收清单',
  risk_register: '风险登记',
  rollout_plan: '上线计划',
  code_context_pack: 'AI Coding 上下文包',
};

export const CURRENT_PRODUCTION_WORKFLOW_KEY =
  'agent-ops.current-production-workflow';

export const WORKFLOW_STATUS_LABELS: Partial<
  Record<ProductionWorkflow['status'], string>
> = {
  running: '运行中',
  pending_approval: '待审批',
  revision_required: '待修订',
  completed: '已完成',
  failed: '失败',
};

export const normalizeArtifactMarkdown = (content: string) =>
  content
    .replace(/\r\n/g, '\n')
    .replace(/```([A-Za-z0-9_-]+)\s+(?=\S)/g, '```$1\n');

export const parseRetrievalConfig = (
  value: unknown,
): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

export const retrievalDebugCard = (label: string, result: any) => {
  const chunks = result?.stages?.final ?? result?.chunks ?? [];
  const count = result?.stages?.count ?? result?.count ?? chunks.length;
  return (
    <Card title={label} size="small">
      <Descriptions
        column={2}
        items={[
          { key: 'count', label: '最终片段', children: count },
          {
            key: 'duration',
            label: '检索耗时',
            children:
              typeof result?.durationMs === 'number'
                ? `${result.durationMs.toFixed(1)} ms`
                : '-',
          },
          {
            key: 'time',
            label: '生成时间',
            children: result?.generatedAt ?? '-',
          },
          {
            key: 'profile',
            label: '实际检索参数',
            children: (
              <pre>{JSON.stringify(result?.profile ?? {}, null, 2)}</pre>
            ),
          },
        ]}
      />
      <Collapse
        items={[
          {
            key: 'diagnostics',
            label: '召回与重排诊断',
            children: <pre>{JSON.stringify(result?.diagnostics, null, 2)}</pre>,
          },
          {
            key: 'chunks',
            label: `最终证据片段（${count}）`,
            children: <pre>{JSON.stringify(chunks, null, 2)}</pre>,
          },
        ]}
      />
    </Card>
  );
};
