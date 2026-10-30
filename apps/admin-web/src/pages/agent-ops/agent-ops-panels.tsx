import type { AgentOpsController } from './agent-ops-controller';
import { renderEvalPanelAndGovernancePanel } from './agent-ops-eval-governance-panels';
import { renderRunCenterPanelAndCollaborationPanel } from './agent-ops-run-collaboration-panels';
import { renderWorkflowPanel } from './agent-ops-workflow-panel';

export function renderAgentOpsPanels(controller: AgentOpsController) {
  return {
    ...renderWorkflowPanel(controller),
    ...renderEvalPanelAndGovernancePanel(controller),
    ...renderRunCenterPanelAndCollaborationPanel(controller),
  };
}
