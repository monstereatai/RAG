import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Store non-searchable parent context and verified source references on leaf chunks. */
export class AddHybridChunkProvenance1789000000000 implements MigrationInterface {
  name = 'AddHybridChunkProvenance1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('document_chunks');
    if (!table) throw new Error('document_chunks table not found');
    if (!table.findColumnByName('parentContent')) {
      await queryRunner.addColumn('document_chunks', new TableColumn({ name:'parentContent', type:'text', isNullable:true }));
    }
    if (!table.findColumnByName('sourceMetadata')) {
      await queryRunner.addColumn('document_chunks', new TableColumn({ name:'sourceMetadata', type:'text', isNullable:true }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('document_chunks');
    if (!table) return;
    if (table.findColumnByName('sourceMetadata')) await queryRunner.dropColumn('document_chunks','sourceMetadata');
    if (table.findColumnByName('parentContent')) await queryRunner.dropColumn('document_chunks','parentContent');
  }
}
