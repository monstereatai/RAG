import '@ant-design/x-markdown/es/XMarkdown/index.css';
import { useAgentOpsController } from './agent-ops-controller';
import { AgentOpsView } from './agent-ops-view';

export default function AgentOpsPage() {
  return <AgentOpsView {...useAgentOpsController()} />;
}
