import '@ant-design/x-markdown/es/XMarkdown/index.css';
import { useWorkflowDetailController } from './workflow-detail-controller';
import { WorkflowDetailView } from './workflow-detail-view';

export default function ProductionWorkflowDetailPage() {
  return <WorkflowDetailView {...useWorkflowDetailController()} />;
}
