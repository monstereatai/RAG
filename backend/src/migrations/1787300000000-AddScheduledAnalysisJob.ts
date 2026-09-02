import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddScheduledAnalysisJob1787300000000
  implements MigrationInterface
{
  name = 'AddScheduledAnalysisJob1787300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduled_jobs');
    if (!table) return;
    const columns = [
      new TableColumn({ name: 'name', type: 'varchar', length: '128', isNullable: true }),
      new TableColumn({ name: 'taskKind', type: 'varchar', length: '24', default: "'agent'" }),
      new TableColumn({ name: 'sourceType', type: 'varchar', length: '24', default: "'natural_language'" }),
      new TableColumn({ name: 'analysisConfig', type: 'text', default: "'{}'" }),
    ];
    for (const column of columns) {
      if (!table.findColumnByName(column.name)) {
        await queryRunner.addColumn('scheduled_jobs', column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduled_jobs');
    if (!table) return;
    for (const name of ['analysisConfig', 'sourceType', 'taskKind', 'name']) {
      if (table.findColumnByName(name)) {
        await queryRunner.dropColumn('scheduled_jobs', name);
      }
    }
  }
}
