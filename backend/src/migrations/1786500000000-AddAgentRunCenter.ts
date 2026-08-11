import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAgentRunCenter1786500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({ name: 'agent_runs', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'threadId', type: 'varchar', length: '64' }, { name: 'queryLogId', type: 'varchar', length: '64', isNullable: true }, { name: 'userId', type: 'varchar', length: '64', isNullable: true }, { name: 'mode', type: 'varchar', length: '32' }, { name: 'route', type: 'varchar', length: '32', isNullable: true }, { name: 'status', type: 'varchar', length: '32', default: "'running'" }, { name: 'currentNode', type: 'varchar', length: '64', isNullable: true }, { name: 'actionCount', type: 'int', default: 0 }, { name: 'retryCount', type: 'int', default: 0 }, { name: 'maxSteps', type: 'int', default: 18 }, { name: 'costUsd', type: 'numeric', precision: 12, scale: 6, default: 0 }, { name: 'requiresApproval', type: 'boolean', default: false }, { name: 'errorMessage', type: 'text', isNullable: true }, { name: 'resultSummary', type: 'text', isNullable: true }, { name: 'finishedAt', type: 'timestamp', isNullable: true }, { name: 'createdAt', type: 'timestamp', default: 'now()' }, { name: 'updatedAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('agent_runs', new TableIndex({ name: 'IDX_agent_runs_thread_created', columnNames: ['threadId', 'createdAt'] }));
    await q.createIndex('agent_runs', new TableIndex({ name: 'IDX_agent_runs_status_created', columnNames: ['status', 'createdAt'] }));
    await q.createTable(new Table({ name: 'agent_actions', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'runId', type: 'varchar', length: '64' }, { name: 'name', type: 'varchar', length: '64' }, { name: 'actionType', type: 'varchar', length: '32' }, { name: 'status', type: 'varchar', length: '32', default: "'success'" }, { name: 'riskLevel', type: 'varchar', length: '32', default: "'low'" }, { name: 'requiresApproval', type: 'boolean', default: false }, { name: 'durationMs', type: 'int', default: 0 }, { name: 'input', type: 'text', isNullable: true }, { name: 'output', type: 'text', isNullable: true }, { name: 'approvedBy', type: 'varchar', length: '64', isNullable: true }, { name: 'createdAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('agent_actions', new TableIndex({ name: 'IDX_agent_actions_run_created', columnNames: ['runId', 'createdAt'] }));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('agent_actions', true);
    await q.dropTable('agent_runs', true);
  }
}
