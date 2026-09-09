import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAgentRuntimeEvents1786800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'agent_runtime_events',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'threadId', type: 'varchar', length: '64' },
          { name: 'runId', type: 'varchar', length: '64', isNullable: true },
          { name: 'taskId', type: 'varchar', length: '64', isNullable: true },
          { name: 'eventType', type: 'varchar', length: '64' },
          { name: 'actor', type: 'varchar', length: '64' },
          { name: 'target', type: 'varchar', length: '64', isNullable: true },
          { name: 'sequence', type: 'int', default: 0 },
          { name: 'payload', type: 'text', default: "'{}'" },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'agent_runtime_events',
      new TableIndex({
        name: 'IDX_agent_runtime_events_thread_seq',
        columnNames: ['threadId', 'sequence'],
      }),
    );
    await q.createIndex(
      'agent_runtime_events',
      new TableIndex({
        name: 'IDX_agent_runtime_events_run_created',
        columnNames: ['runId', 'createdAt'],
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('agent_runtime_events', true);
  }
}
