import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAgentRuntimeControls1787800000000
  implements MigrationInterface
{
  async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('agent_runs');
    if (!table) return;
    const additions = [
      new TableColumn({ name: 'cancelledAt', type: 'timestamp', isNullable: true }),
      new TableColumn({ name: 'cancelReason', type: 'text', isNullable: true }),
      new TableColumn({ name: 'lastCheckpointAt', type: 'timestamp', isNullable: true }),
    ];
    for (const column of additions) {
      if (!table.findColumnByName(column.name)) {
        await q.addColumn('agent_runs', column);
      }
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const table = await q.getTable('agent_runs');
    if (!table) return;
    for (const name of ['lastCheckpointAt', 'cancelReason', 'cancelledAt']) {
      const column = table.findColumnByName(name);
      if (column) await q.dropColumn('agent_runs', column);
    }
  }
}
