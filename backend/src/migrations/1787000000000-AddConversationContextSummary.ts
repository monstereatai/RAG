import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddConversationContextSummary1787000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const table = await q.getTable('conversations');
    if (!table) return;
    const columns = [
      new TableColumn({ name: 'contextSummary', type: 'text', isNullable: true }),
      new TableColumn({ name: 'contextSummaryVersion', type: 'int', default: 0 }),
      new TableColumn({ name: 'contextSummaryUpdatedAt', type: 'timestamp', isNullable: true }),
    ];
    for (const column of columns) {
      if (!table.findColumnByName(column.name)) await q.addColumn('conversations', column);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const table = await q.getTable('conversations');
    if (!table) return;
    for (const name of ['contextSummaryUpdatedAt', 'contextSummaryVersion', 'contextSummary']) {
      const column = table.findColumnByName(name);
      if (column) await q.dropColumn('conversations', column);
    }
  }
}
