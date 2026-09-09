import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAgentRunBudgets1786900000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('agent_runs');
    if (!table) return;
    const additions = [
      new TableColumn({ name: 'maxToolCalls', type: 'int', default: 24 }),
      new TableColumn({ name: 'toolCallCount', type: 'int', default: 0 }),
      new TableColumn({ name: 'maxDelegations', type: 'int', default: 6 }),
      new TableColumn({ name: 'delegationCount', type: 'int', default: 0 }),
    ];
    for (const column of additions) {
      if (!table.findColumnByName(column.name))
        await q.addColumn('agent_runs', column);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const table = await q.getTable('agent_runs');
    if (!table) return;
    for (const name of [
      'delegationCount',
      'maxDelegations',
      'toolCallCount',
      'maxToolCalls',
    ]) {
      const column = table.findColumnByName(name);
      if (column) await q.dropColumn('agent_runs', column);
    }
  }
}
