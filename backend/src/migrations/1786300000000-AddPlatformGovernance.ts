import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddPlatformGovernance1786300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'workflow_templates',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'key', type: 'varchar', length: '128' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'workspaceId',
            type: 'varchar',
            length: '64',
            default: "'default'",
          },
          { name: 'status', type: 'varchar', length: '32', default: "'draft'" },
          { name: 'activeVersion', type: 'int', default: 0 },
          { name: 'ownerId', type: 'varchar', length: '64', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'workflow_templates',
      new TableIndex({
        name: 'IDX_workflow_templates_workspace_key',
        columnNames: ['workspaceId', 'key'],
        isUnique: true,
      }),
    );
    await q.createTable(
      new Table({
        name: 'workflow_template_versions',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'templateId', type: 'varchar', length: '64' },
          { name: 'version', type: 'int' },
          { name: 'definition', type: 'text' },
          { name: 'status', type: 'varchar', length: '32', default: "'draft'" },
          {
            name: 'createdBy',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'workflow_template_versions',
      new TableIndex({
        name: 'IDX_workflow_template_versions_template',
        columnNames: ['templateId', 'version'],
        isUnique: true,
      }),
    );
    await q.createTable(
      new Table({
        name: 'platform_plugins',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'key', type: 'varchar', length: '128' },
          { name: 'type', type: 'varchar', length: '32' },
          { name: 'version', type: 'varchar', length: '64' },
          { name: 'capabilities', type: 'text', default: "'[]'" },
          { name: 'permissions', type: 'text', default: "'[]'" },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'enabled'",
          },
          { name: 'timeoutMs', type: 'int', default: 5000 },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'platform_plugins',
      new TableIndex({
        name: 'IDX_platform_plugins_key_version',
        columnNames: ['key', 'version'],
        isUnique: true,
      }),
    );
    await q.createTable(
      new Table({
        name: 'model_registry',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'provider', type: 'varchar', length: '64' },
          { name: 'model', type: 'varchar', length: '128' },
          { name: 'capabilities', type: 'text', default: "'[]'" },
          { name: 'pricing', type: 'text', default: "'{}'" },
          {
            name: 'fallbackModel',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'enabled'",
          },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'model_registry',
      new TableIndex({
        name: 'IDX_model_registry_provider_model',
        columnNames: ['provider', 'model'],
        isUnique: true,
      }),
    );
    await q.createTable(
      new Table({
        name: 'evaluation_cases',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          {
            name: 'sourceFeedbackId',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'workspaceId',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'query', type: 'text' },
          { name: 'expectedAnswer', type: 'text' },
          { name: 'expectedReferences', type: 'text', default: "'[]'" },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'active'",
          },
          {
            name: 'createdBy',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );
    await q.createIndex(
      'evaluation_cases',
      new TableIndex({
        name: 'IDX_evaluation_cases_source',
        columnNames: ['sourceFeedbackId'],
      }),
    );
    await q.createIndex(
      'evaluation_cases',
      new TableIndex({
        name: 'IDX_evaluation_cases_status',
        columnNames: ['status', 'createdAt'],
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('evaluation_cases', true);
    await q.dropTable('model_registry', true);
    await q.dropTable('platform_plugins', true);
    await q.dropTable('workflow_template_versions', true);
    await q.dropTable('workflow_templates', true);
  }
}
