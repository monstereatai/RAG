import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBadCaseKnowledgePromotion1787100000000 implements MigrationInterface {
  name = 'AddBadCaseKnowledgePromotion1787100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('rag_feedback');
    if (!table) return;
    const columns: TableColumn[] = [
      new TableColumn({
        name: 'knowledgeLayer',
        type: 'varchar',
        length: '16',
        default: "'correction'",
      }),
      new TableColumn({
        name: 'promotionStatus',
        type: 'varchar',
        length: '24',
        default: "'not_requested'",
      }),
      new TableColumn({
        name: 'promotionSource',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'promotedDocId',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'promotedBy',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'promotedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    ];
    for (const column of columns) {
      if (!table.findColumnByName(column.name)) {
        await queryRunner.addColumn('rag_feedback', column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('rag_feedback');
    if (!table) return;
    for (const name of [
      'promotedAt',
      'promotedBy',
      'promotedDocId',
      'promotionSource',
      'promotionStatus',
      'knowledgeLayer',
    ]) {
      if (table.findColumnByName(name))
        await queryRunner.dropColumn('rag_feedback', name);
    }
  }
}
