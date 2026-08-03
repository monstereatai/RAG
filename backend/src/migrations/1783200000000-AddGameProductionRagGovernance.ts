import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddGameProductionRagGovernance1783200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await this.addGovernanceColumns(queryRunner, 'documents_meta', true);
    await this.addGovernanceColumns(queryRunner, 'document_chunks', false);
    await this.addColumnIfMissing(
      queryRunner,
      'query_logs',
      new TableColumn({ name: 'answer', type: 'text', isNullable: true }),
    );
    await this.addColumnIfMissing(
      queryRunner,
      'query_logs',
      new TableColumn({
        name: 'retrievalSnapshot',
        type: 'text',
        isNullable: true,
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'documents_meta',
      new TableIndex({
        name: 'IDX_documents_meta_project_activity',
        columnNames: ['projectId', 'activityId'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'documents_meta',
      new TableIndex({
        name: 'IDX_documents_meta_lifecycle',
        columnNames: ['lifecycleStatus'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_project_activity',
        columnNames: ['projectId', 'activityId'],
      }),
    );
    await this.createIndexIfMissing(
      queryRunner,
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_lifecycle',
        columnNames: ['lifecycleStatus'],
      }),
    );

    if (!(await queryRunner.hasTable('rag_feedback'))) {
      await queryRunner.createTable(
        new Table({
          name: 'rag_feedback',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            {
              name: 'queryLogId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'threadId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'userId', type: 'varchar', length: '64', isNullable: true },
            { name: 'feedback', type: 'varchar', length: '16' },
            {
              name: 'errorType',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'comment', type: 'text', isNullable: true },
            { name: 'correctedAnswer', type: 'text', isNullable: true },
            { name: 'retrievalSnapshot', type: 'text', isNullable: true },
            {
              name: 'status',
              type: 'varchar',
              length: '32',
              default: "'pending'",
            },
            { name: 'includeInRegression', type: 'boolean', default: false },
            {
              name: 'reviewedBy',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'reviewedAt', type: 'timestamp', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndices('rag_feedback', [
        new TableIndex({
          name: 'IDX_rag_feedback_user_status',
          columnNames: ['userId', 'status'],
        }),
        new TableIndex({
          name: 'IDX_rag_feedback_query_log',
          columnNames: ['queryLogId'],
        }),
        new TableIndex({
          name: 'IDX_rag_feedback_created',
          columnNames: ['createdAt'],
        }),
      ]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('rag_feedback')) {
      await queryRunner.dropTable('rag_feedback');
    }
    await this.dropColumnIfExists(
      queryRunner,
      'query_logs',
      'retrievalSnapshot',
    );
    await this.dropColumnIfExists(queryRunner, 'query_logs', 'answer');
    await this.dropIndexIfExists(
      queryRunner,
      'document_chunks',
      'IDX_document_chunks_lifecycle',
    );
    await this.dropIndexIfExists(
      queryRunner,
      'document_chunks',
      'IDX_document_chunks_project_activity',
    );
    await this.dropIndexIfExists(
      queryRunner,
      'documents_meta',
      'IDX_documents_meta_lifecycle',
    );
    await this.dropIndexIfExists(
      queryRunner,
      'documents_meta',
      'IDX_documents_meta_project_activity',
    );
    await this.dropGovernanceColumns(queryRunner, 'document_chunks', false);
    await this.dropGovernanceColumns(queryRunner, 'documents_meta', true);
  }

  private async addGovernanceColumns(
    queryRunner: QueryRunner,
    table: string,
    includeQuality: boolean,
  ): Promise<void> {
    const columns = [
      new TableColumn({
        name: 'projectId',
        type: 'varchar',
        length: '128',
        isNullable: true,
      }),
      new TableColumn({
        name: 'activityId',
        type: 'varchar',
        length: '128',
        isNullable: true,
      }),
      new TableColumn({
        name: 'region',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'locale',
        type: 'varchar',
        length: '32',
        isNullable: true,
      }),
      new TableColumn({
        name: 'channel',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'roleScope',
        type: 'varchar',
        length: '512',
        isNullable: true,
      }),
      new TableColumn({
        name: 'documentType',
        type: 'varchar',
        length: '32',
        default: "'general'",
      }),
      new TableColumn({
        name: 'lifecycleStatus',
        type: 'varchar',
        length: '32',
        default: "'effective'",
      }),
      new TableColumn({
        name: 'supersedesDocId',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      ...(includeQuality
        ? [
            new TableColumn({
              name: 'ingestionQuality',
              type: 'text',
              isNullable: true,
            }),
          ]
        : []),
    ];
    for (const column of columns) {
      if (!(await queryRunner.hasColumn(table, column.name))) {
        await queryRunner.addColumn(table, column);
      }
    }
  }

  private async dropGovernanceColumns(
    queryRunner: QueryRunner,
    table: string,
    includeQuality: boolean,
  ): Promise<void> {
    const names = [
      'projectId',
      'activityId',
      'region',
      'locale',
      'channel',
      'roleScope',
      'documentType',
      'lifecycleStatus',
      'supersedesDocId',
      ...(includeQuality ? ['ingestionQuality'] : []),
    ];
    for (const name of names) {
      if (await queryRunner.hasColumn(table, name)) {
        await queryRunner.dropColumn(table, name);
      }
    }
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (table && !table.indices.some((item) => item.name === index.name)) {
      await queryRunner.createIndex(tableName, index);
    }
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ): Promise<void> {
    if (!(await queryRunner.hasColumn(tableName, column.name))) {
      await queryRunner.addColumn(tableName, column);
    }
  }

  private async dropColumnIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
  ): Promise<void> {
    if (await queryRunner.hasColumn(tableName, columnName)) {
      await queryRunner.dropColumn(tableName, columnName);
    }
  }

  private async dropIndexIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (table?.indices.some((item) => item.name === indexName)) {
      await queryRunner.dropIndex(tableName, indexName);
    }
  }
}
