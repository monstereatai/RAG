import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddKnowledgeBaseGovernance1786400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'knowledge_base_profiles',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'key', type: 'varchar', length: '128' },
          { name: 'name', type: 'varchar', length: '255' },
          {
            name: 'workspaceId',
            type: 'varchar',
            length: '64',
            default: "'default'",
          },
          {
            name: 'documentType',
            type: 'varchar',
            length: '32',
            default: "'general'",
          },
          { name: 'chunkSize', type: 'int', default: 500 },
          { name: 'chunkOverlap', type: 'int', default: 50 },
          { name: 'retrievalConfig', type: 'text', default: "'{}'" },
          { name: 'syncConfig', type: 'text', default: "'{}'" },
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
      'knowledge_base_profiles',
      new TableIndex({
        name: 'IDX_knowledge_base_profiles_workspace_key',
        columnNames: ['workspaceId', 'key'],
        isUnique: true,
      }),
    );
    const meta = await q.getTable('documents_meta');
    if (
      meta &&
      !meta.columns.some((column) => column.name === 'chunkStrategy')
    ) {
      await q.addColumn(
        'documents_meta',
        new TableColumn({
          name: 'chunkStrategy',
          type: 'text',
          isNullable: true,
        }),
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const meta = await q.getTable('documents_meta');
    if (meta?.columns.some((column) => column.name === 'chunkStrategy')) {
      await q.dropColumn('documents_meta', 'chunkStrategy');
    }
    await q.dropTable('knowledge_base_profiles', true);
  }
}
