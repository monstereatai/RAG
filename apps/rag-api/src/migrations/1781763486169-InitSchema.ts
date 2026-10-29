import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitSchema1781763486169 implements MigrationInterface {
  name = 'InitSchema1781763486169';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'username', type: 'varchar', length: '64', isUnique: true },
          { name: 'passwordHash', type: 'varchar', length: '255' },
          { name: 'role', type: 'varchar', length: '32', default: "'user'" },
          { name: 'tenantId', type: 'varchar', length: '64', isNullable: true },
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
      true,
    );

    // 2. conversations
    await queryRunner.createTable(
      new Table({
        name: 'conversations',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
          { name: 'title', type: 'varchar', length: '100', default: "''" },
          { name: 'mode', type: 'varchar', length: '16', default: "'auto'" },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // 3. messages
    await queryRunner.createTable(
      new Table({
        name: 'messages',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'conversationId', type: 'varchar', length: '64' },
          { name: 'role', type: 'varchar', length: '8' },
          { name: 'content', type: 'text' },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create index on messages (conversationId, createdAt)
    await queryRunner.createIndex(
      'messages',
      new TableIndex({
        name: 'IDX_751332fc6cc6fc576c6975cd07',
        columnNames: ['conversationId', 'createdAt'],
      }),
    );

    // 4. documents_meta
    await queryRunner.createTable(
      new Table({
        name: 'documents_meta',
        columns: [
          { name: 'docId', type: 'varchar', length: '64', isPrimary: true },
          { name: 'filename', type: 'varchar', length: '512' },
          { name: 'chunkCount', type: 'int', default: 0 },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
          { name: 'title', type: 'varchar', length: '256', isNullable: true },
          { name: 'author', type: 'varchar', length: '128', isNullable: true },
          { name: 'summary', type: 'varchar', length: '512', isNullable: true },
          {
            name: 'keywords',
            type: 'varchar',
            length: '512',
            isNullable: true,
          },
          { name: 'language', type: 'varchar', length: '32', isNullable: true },
          { name: 'category', type: 'varchar', length: '32', isNullable: true },
          {
            name: 'docVersion',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'effectiveAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'expiredAt',
            type: 'timestamp',
            isNullable: true,
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

    // 5. document_chunks
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
    await queryRunner.createIndex(
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_doc_user',
        columnNames: ['docId', 'userId'],
      }),
    );
    await queryRunner.createIndex(
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_parent',
        columnNames: ['parentChunkId'],
      }),
    );
    await queryRunner.createIndex(
      'document_chunks',
      new TableIndex({
        name: 'IDX_document_chunks_effective',
        columnNames: ['effectiveAt', 'expiredAt'],
      }),
    );

    // 6. fact_conflicts
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
    await queryRunner.createIndex(
      'fact_conflicts',
      new TableIndex({
        name: 'IDX_fact_conflicts_user_subject',
        columnNames: ['userId', 'subject'],
      }),
    );
    await queryRunner.createIndex(
      'fact_conflicts',
      new TableIndex({
        name: 'IDX_fact_conflicts_doc',
        columnNames: ['docId'],
      }),
    );

    // 7. scheduled_jobs
    await queryRunner.createTable(
      new Table({
        name: 'scheduled_jobs',
        columns: [
          { name: 'id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'type', type: 'varchar', length: '16' },
          { name: 'instruction', type: 'text' },
          { name: 'enabled', type: 'boolean', default: 'true' },
          { name: 'running', type: 'boolean', default: 'false' },
          { name: 'cron', type: 'varchar', length: '64', isNullable: true },
          { name: 'everyMs', type: 'integer', isNullable: true },
          { name: 'at', type: 'varchar', length: '64', isNullable: true },
          { name: 'lastRun', type: 'varchar', length: '64', isNullable: true },
          { name: 'userId', type: 'varchar', length: '64', isNullable: true },
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
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('scheduled_jobs');
    await queryRunner.dropIndex('fact_conflicts', 'IDX_fact_conflicts_doc');
    await queryRunner.dropIndex(
      'fact_conflicts',
      'IDX_fact_conflicts_user_subject',
    );
    await queryRunner.dropTable('fact_conflicts');
    await queryRunner.dropIndex(
      'document_chunks',
      'IDX_document_chunks_effective',
    );
    await queryRunner.dropIndex(
      'document_chunks',
      'IDX_document_chunks_parent',
    );
    await queryRunner.dropIndex(
      'document_chunks',
      'IDX_document_chunks_doc_user',
    );
    await queryRunner.dropTable('document_chunks');
    await queryRunner.dropTable('documents_meta');
    await queryRunner.dropIndex('messages', 'IDX_751332fc6cc6fc576c6975cd07');
    await queryRunner.dropTable('messages');
    await queryRunner.dropTable('conversations');
    await queryRunner.dropTable('users');
  }
}
