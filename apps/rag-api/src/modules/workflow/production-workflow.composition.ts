import type { ProductionWorkflowDependencies } from './production-workflow.shared';
import { ProductionWorkflowRuntime } from './production-workflow.runtime';
import { ProductionWorkflowEvents } from './production-workflow.events';
import { ProductionWorkflowStateService } from './production-workflow.state-service';
import { ProductionWorkflowRoleSupport } from './production-workflow.role-support';
import { ProductionWorkflowExecution } from './production-workflow.execution';
import { ProductionWorkflowControl } from './production-workflow.control';
import { ProductionWorkflowQuery } from './production-workflow.query';
import { ProductionWorkflowRevision } from './production-workflow.revision';
import type { ProductionWorkflowContext } from './production-workflow.context';

/** Give every component a stable name so calls reveal their owner. */
export function composeProductionWorkflow(
  dependencies: ProductionWorkflowDependencies,
): ProductionWorkflowContext {
  const context = new ProductionWorkflowRuntime(dependencies);
  context.events = new ProductionWorkflowEvents(context);
  context.state = new ProductionWorkflowStateService(context);
  context.roleSupport = new ProductionWorkflowRoleSupport(context);
  context.execution = new ProductionWorkflowExecution(context);
  context.control = new ProductionWorkflowControl(context);
  context.query = new ProductionWorkflowQuery(context);
  context.revision = new ProductionWorkflowRevision(context);

  return context;
}
