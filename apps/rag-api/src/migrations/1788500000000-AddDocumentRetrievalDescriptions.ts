import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddDocumentRetrievalDescriptions1788500000000 implements MigrationInterface {
  name = 'AddDocumentRetrievalDescriptions1788500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('document_retrieval_descriptions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'document_retrieval_descriptions',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'docId', type: 'varchar', length: '64' },
            {
              name: 'docVersion',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'indexGeneration',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'descriptionType', type: 'varchar', length: '64' },
            { name: 'content', type: 'text' },
            { name: 'contentHash', type: 'varchar', length: '64' },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndices('document_retrieval_descriptions', [
        new TableIndex({
          name: 'IDX_document_retrieval_descriptions_doc',
          columnNames: ['tenantId', 'docId', 'indexGeneration'],
        }),
        new TableIndex({
          name: 'IDX_document_retrieval_descriptions_content_hash',
          columnNames: ['tenantId', 'docId', 'descriptionType', 'contentHash'],
        }),
      ]);
    }

    if (
      !(await queryRunner.hasTable('document_retrieval_description_chunks'))
    ) {
      await queryRunner.createTable(
        new Table({
          name: 'document_retrieval_description_chunks',
          columns: [
            {
              name: 'descriptionId',
              type: 'varchar',
              length: '64',
              isPrimary: true,
            },
            {
              name: 'sourceChunkId',
              type: 'varchar',
              length: '64',
              isPrimary: true,
            },
          ],
        }),
      );
      await queryRunner.createForeignKey(
        'document_retrieval_description_chunks',
        new TableForeignKey({
          name: 'FK_document_retrieval_description_chunks_description',
          columnNames: ['descriptionId'],
          referencedTableName: 'document_retrieval_descriptions',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
      await queryRunner.createForeignKey(
        'document_retrieval_description_chunks',
        new TableForeignKey({
          name: 'FK_document_retrieval_description_chunks_source',
          columnNames: ['sourceChunkId'],
          referencedTableName: 'document_chunks',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
      await queryRunner.createIndex(
        'document_retrieval_description_chunks',
        new TableIndex({
          name: 'IDX_document_retrieval_description_chunks_source',
          columnNames: ['sourceChunkId'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('document_retrieval_description_chunks')) {
      await queryRunner.dropTable('document_retrieval_description_chunks');
    }
    if (await queryRunner.hasTable('document_retrieval_descriptions')) {
      await queryRunner.dropTable('document_retrieval_descriptions');
    }
  }
}
