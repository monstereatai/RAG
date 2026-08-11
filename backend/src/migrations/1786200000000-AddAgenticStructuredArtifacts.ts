import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAgenticStructuredArtifacts1786200000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('agentic_structured_artifacts')) return;

    await queryRunner.createTable(
      new Table({
        name: 'agentic_structured_artifacts',
        columns: [
          { name: 'id', type: 'varchar', length: '128', isPrimary: true },
          { name: 'threadId', type: 'varchar', length: '64' },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
          { name: 'artifactId', type: 'varchar', length: '128' },
          { name: 'type', type: 'varchar', length: '64' },
          { name: 'producer', type: 'varchar', length: '64' },
          { name: 'version', type: 'int', default: 1 },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'ready_for_review'",
          },
          { name: 'payload', type: 'text' },
          { name: 'sourceDocIds', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );
    await queryRunner.createIndices('agentic_structured_artifacts', [
      new TableIndex({
        name: 'IDX_agentic_structured_artifacts_thread',
        columnNames: ['threadId', 'createdAt'],
      }),
      new TableIndex({
        name: 'IDX_agentic_structured_artifacts_user',
        columnNames: ['userId', 'createdAt'],
      }),
      new TableIndex({
        name: 'IDX_agentic_structured_artifacts_type',
        columnNames: ['type', 'createdAt'],
      }),
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('agentic_structured_artifacts')) {
      await queryRunner.dropTable('agentic_structured_artifacts');
    }
  }
}
