import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class UniqueRuntimeEventSequence1788300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('agent_runtime_events'))) return;
    const table = await queryRunner.getTable('agent_runtime_events');
    if (
      table?.indices.some(
        (index) =>
          index.name === 'UQ_agent_runtime_events_tenant_thread_sequence',
      )
    ) {
      return;
    }
    await queryRunner.createIndex(
      'agent_runtime_events',
      new TableIndex({
        name: 'UQ_agent_runtime_events_tenant_thread_sequence',
        columnNames: ['tenantId', 'threadId', 'sequence'],
        isUnique: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('agent_runtime_events'))) return;
    const table = await queryRunner.getTable('agent_runtime_events');
    const index = table?.indices.find(
      (item) => item.name === 'UQ_agent_runtime_events_tenant_thread_sequence',
    );
    if (index) await queryRunner.dropIndex('agent_runtime_events', index);
  }
}
