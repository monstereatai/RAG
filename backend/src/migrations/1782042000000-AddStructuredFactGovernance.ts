import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddStructuredFactGovernance1782042000000 implements MigrationInterface {
  name = 'AddStructuredFactGovernance1782042000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(
      queryRunner,
      'documents_meta',
      new TableColumn({
        name: 'docVersion',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      'documents_meta',
      new TableColumn({
        name: 'effectiveAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      'documents_meta',
      new TableColumn({
        name: 'expiredAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      'documents_meta',
      new TableColumn({
        name: 'sourceAuthority',
        type: 'varchar',
        length: '32',
        default: "'normal'",
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'document_chunks',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'docId', type: 'varchar', length: '64' },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
          {
            name: 'parentChunkId',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          { name: 'chunkIndex', type: 'int' },
          {
            name: 'chunkType',
            type: 'varchar',
            length: '32',
            default: "'leaf'",
          },
          { name: 'content', type: 'text' },
          {
            name: 'headingPath',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'sectionId',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'clauseId',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'tableRef',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          { name: 'sourceStart', type: 'int', isNullable: true },
          { name: 'sourceEnd', type: 'int', isNullable: true },
          {
            name: 'docVersion',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'effectiveAt', type: 'timestamp', isNullable: true },
          { name: 'expiredAt', type: 'timestamp', isNullable: true },
          {
            name: 'sourceAuthority',
            type: 'varchar',
            length: '32',
            default: "'normal'",
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );
    await this.createIndexIfMissing(
      queryRunner,
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_doc_user',
        columnNames: ['docId', 'userId'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_parent',
        columnNames: ['parentChunkId'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_effective',
        columnNames: ['effectiveAt', 'expiredAt'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'fact_conflicts',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
          { name: 'docId', type: 'varchar', length: '64' },
          { name: 'chunkId', type: 'varchar', length: '64', isNullable: true },
          { name: 'subject', type: 'varchar', length: '256' },
          { name: 'predicate', type: 'varchar', length: '128' },
          {
            name: 'currentValue',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'conflictingValue',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          {
            name: 'currentVersion',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'conflictingVersion',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'detected'",
          },
          {
            name: 'sourceAuthority',
            type: 'varchar',
            length: '32',
            default: "'normal'",
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );
    await this.createIndexIfMissing(
      queryRunner,
      'fact_conflicts',
      new TableIndex({
        name: 'IDX_fact_conflicts_user_subject',
        columnNames: ['userId', 'subject'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'fact_conflicts',
      new TableIndex({
        name: 'IDX_fact_conflicts_doc',
        columnNames: ['docId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('fact_conflicts', true);
    await queryRunner.dropTable('document_chunks', true);
    await this.dropColumnIfExists(
      queryRunner,
      'documents_meta',
      'sourceAuthority',
    );
    await this.dropColumnIfExists(queryRunner, 'documents_meta', 'expiredAt');
    await this.dropColumnIfExists(queryRunner, 'documents_meta', 'effectiveAt');
    await this.dropColumnIfExists(queryRunner, 'documents_meta', 'docVersion');
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table?.findColumnByName(column.name)) {
      await queryRunner.addColumn(tableName, column);
    }
  }

  private async dropColumnIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (table?.findColumnByName(columnName)) {
      await queryRunner.dropColumn(tableName, columnName);
    }
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table?.indices.some((item) => item.name === index.name)) {
      await queryRunner.createIndex(tableName, index);
    }
  }
}
