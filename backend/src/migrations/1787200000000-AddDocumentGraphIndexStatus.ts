import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDocumentGraphIndexStatus1787200000000
  implements MigrationInterface
{
  name = 'AddDocumentGraphIndexStatus1787200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('documents_meta');
    if (!table) return;
    const columns: TableColumn[] = [
      new TableColumn({
        name: 'graphIndexStatus',
        type: 'varchar',
        length: '24',
        default: "'skipped'",
      }),
      new TableColumn({
        name: 'graphIndexedAt',
        type: 'timestamp',
        isNullable: true,
      }),
      new TableColumn({
        name: 'graphIndexError',
        type: 'text',
        isNullable: true,
      }),
    ];
    for (const column of columns) {
      if (!table.findColumnByName(column.name)) {
        await queryRunner.addColumn('documents_meta', column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('documents_meta');
    if (!table) return;
    for (const name of [
      'graphIndexError',
      'graphIndexedAt',
      'graphIndexStatus',
    ]) {
      if (table.findColumnByName(name)) {
        await queryRunner.dropColumn('documents_meta', name);
      }
    }
  }
}
