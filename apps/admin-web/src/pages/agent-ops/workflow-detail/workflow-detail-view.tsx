import { history } from '@umijs/max';
import { Button, Result, Spin } from 'antd';
import { agentOpsNav, ModulePage } from '@/components/AdminShell';
import { renderWorkflowArtifacts } from './workflow-detail-artifact-sections';
import type { WorkflowDetailController } from './workflow-detail-controller';
import { renderWorkflowOverview } from './workflow-detail-overview-sections';
import { renderWorkflowPlayway } from './workflow-detail-playway-sections';

export function WorkflowDetailView(controller: WorkflowDetailController) {
  const { workflow, loading } = controller;
  const detailContent = loading ? (
    <Spin description="正在加载工作流详情" />
  ) : !workflow ? (
    <Result
      status="404"
      title="工作流不存在"
      subTitle="该 Thread 可能已过期或当前账号无权访问。"
      extra={
        <Button onClick={() => history.push('/agent-ops')}>
          返回工作流列表
        </Button>
      }
    />
  ) : (
    <>
      {renderWorkflowOverview({ ...controller, workflow })}
      {renderWorkflowArtifacts({ ...controller, workflow })}
      {renderWorkflowPlayway({ ...controller, workflow })}
    </>
  );
  return (
    <ModulePage activeKey="workspace" navItems={agentOpsNav} title="Agent 运营">
      <div className="agent-ops-page">
        <header>
          <h2>产研运工作流详情</h2>
          <p>查看一次工作流的状态、阶段产物、证据和审批记录。</p>
        </header>
        {detailContent}
      </div>
    </ModulePage>
  );
}
