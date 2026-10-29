import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddGeneratedArtifacts1785727200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('generated_artifacts'))) {
      await queryRunner.createTable(
        new Table({
          name: 'generated_artifacts',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'ownerUserId', type: 'varchar', length: '64' },
            {
              name: 'threadId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'title', type: 'varchar', length: '256' },
            { name: 'kind', type: 'varchar', length: '32' },
            {
              name: 'status',
              type: 'varchar',
              length: '32',
              default: "'queued'",
            },
            { name: 'filename', type: 'varchar', length: '512' },
            { name: 'sourceText', type: 'text' },
            { name: 'prompt', type: 'text', isNullable: true },
            {
              name: 'objectKey',
              type: 'varchar',
              length: '1024',
              isNullable: true,
            },
            {
              name: 'storageUrl',
              type: 'varchar',
              length: '1024',
              isNullable: true,
            },
            {
              name: 'contentType',
              type: 'varchar',
              length: '128',
              isNullable: true,
            },
            { name: 'size', type: 'int', default: 0 },
            { name: 'metadata', type: 'text', isNullable: true },
            { name: 'errorMessage', type: 'text', isNullable: true },
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
      await queryRunner.createIndices('generated_artifacts', [
        new TableIndex({
          name: 'IDX_generated_artifacts_owner_created',
          columnNames: ['ownerUserId', 'createdAt'],
        }),
        new TableIndex({
          name: 'IDX_generated_artifacts_thread',
          columnNames: ['threadId'],
        }),
        new TableIndex({
          name: 'IDX_generated_artifacts_status',
          columnNames: ['status'],
        }),
      ]);
    }

    if (!(await queryRunner.hasTable('artifact_shares'))) {
      await queryRunner.createTable(
        new Table({
          name: 'artifact_shares',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'artifactId', type: 'varchar', length: '64' },
            { name: 'createdBy', type: 'varchar', length: '64' },
            { name: 'visibility', type: 'varchar', length: '16' },
            {
              name: 'tokenHash',
              type: 'varchar',
              length: '64',
              isUnique: true,
            },
            { name: 'expiresAt', type: 'timestamp', isNullable: true },
            { name: 'maxDownloads', type: 'int', isNullable: true },
            { name: 'downloadCount', type: 'int', default: 0 },
            { name: 'revokedAt', type: 'timestamp', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndices('artifact_shares', [
        new TableIndex({
          name: 'IDX_artifact_shares_artifact',
          columnNames: ['artifactId'],
        }),
        new TableIndex({
          name: 'IDX_artifact_shares_token',
          columnNames: ['tokenHash'],
          isUnique: true,
        }),
      ]);
    }

    if (!(await queryRunner.hasTable('artifact_access_logs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'artifact_access_logs',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'artifactId', type: 'varchar', length: '64' },
            {
              name: 'shareId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'actorUserId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'action', type: 'varchar', length: '16' },
            { name: 'ip', type: 'varchar', length: '128', isNullable: true },
            {
              name: 'userAgent',
              type: 'varchar',
              length: '512',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
      await queryRunner.createIndices('artifact_access_logs', [
        new TableIndex({
          name: 'IDX_artifact_access_logs_artifact_created',
          columnNames: ['artifactId', 'createdAt'],
        }),
        new TableIndex({
          name: 'IDX_artifact_access_logs_share',
          columnNames: ['shareId'],
        }),
      ]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'artifact_access_logs',
      'artifact_shares',
      'generated_artifacts',
    ]) {
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
