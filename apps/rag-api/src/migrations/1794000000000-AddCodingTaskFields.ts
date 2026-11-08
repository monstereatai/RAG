import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddCodingTaskFields1794000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumns('agent_tasks', [
      new TableColumn({
        name: 'taskType',
        type: 'varchar',
        length: '32',
        default: "'workflow_role'",
      }),
      new TableColumn({
        name: 'ownerUserId',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'requestId',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'requestHash',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'codingContext',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'verification',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({ name: 'lastCompletedStep', type: 'int', default: 0 }),
    ]);
    await q.createIndex(
      'agent_tasks',
      new TableIndex({
        name: 'UQ_agent_tasks_tenant_owner_request',
        columnNames: ['tenantId', 'ownerUserId', 'requestId'],
        isUnique: true,
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropIndex('agent_tasks', 'UQ_agent_tasks_tenant_owner_request');
    await q.dropColumns('agent_tasks', [
      'taskType',
      'ownerUserId',
      'requestId',
      'requestHash',
      'codingContext',
      'verification',
      'lastCompletedStep',
    ]);
  }
}
