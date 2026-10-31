import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAgentRunCancellationSignalStatus1788900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_runs');
    if (!table || table.findColumnByName('cancelSignalPending')) return;

    await queryRunner.addColumn(
      'agent_runs',
      new TableColumn({
        name: 'cancelSignalPending',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('agent_runs');
    const column = table?.findColumnByName('cancelSignalPending');
    if (column) await queryRunner.dropColumn('agent_runs', column);
  }
}
