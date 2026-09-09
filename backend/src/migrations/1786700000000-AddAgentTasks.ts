import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAgentTasks1786700000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'agent_tasks',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'threadId', type: 'varchar', length: '64' },
          { name: 'runId', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'parentTaskId',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'role', type: 'varchar', length: '64' },
          { name: 'title', type: 'varchar', length: '128' },
          { name: 'description', type: 'text', default: "''" },
          {
            name: 'processType',
            type: 'varchar',
            length: '32',
            default: "'sequential'",
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'pending'",
          },
          { name: 'dependsOnTaskIds', type: 'text', default: "'[]'" },
          { name: 'inputArtifactIds', type: 'text', default: "'[]'" },
          {
            name: 'outputArtifactId',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          { name: 'approvalRequired', type: 'boolean', default: false },
          { name: 'retryCount', type: 'int', default: 0 },
          { name: 'resultSummary', type: 'text', isNullable: true },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'agent_tasks',
      new TableIndex({
        name: 'IDX_agent_tasks_thread_status',
        columnNames: ['threadId', 'status'],
      }),
    );
    await q.createIndex(
      'agent_tasks',
      new TableIndex({
        name: 'IDX_agent_tasks_parent',
        columnNames: ['parentTaskId'],
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('agent_tasks', true);
  }
}
