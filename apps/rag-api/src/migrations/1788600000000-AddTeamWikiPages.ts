import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddTeamWikiPages1788600000000 implements MigrationInterface {
  name = 'AddTeamWikiPages1788600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('team_wiki_pages'))) {
      await queryRunner.createTable(
        new Table({
          name: 'team_wiki_pages',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'title', type: 'varchar', length: '256' },
            {
              name: 'currentRevisionId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'lastPublishedRevisionId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'createdBy', type: 'varchar', length: '64' },
            { name: 'updatedBy', type: 'varchar', length: '64' },
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
            { name: 'deletedAt', type: 'timestamp', isNullable: true },
          ],
        }),
      );
      await queryRunner.createIndex(
        'team_wiki_pages',
        new TableIndex({
          name: 'IDX_team_wiki_pages_tenant_updated',
          columnNames: ['tenantId', 'updatedAt'],
        }),
      );
    }

    if (!(await queryRunner.hasTable('team_wiki_revisions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'team_wiki_revisions',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'pageId', type: 'varchar', length: '64' },
            { name: 'revisionNumber', type: 'int' },
            { name: 'title', type: 'varchar', length: '256' },
            { name: 'content', type: 'text' },
            { name: 'referencesJson', type: 'text' },
            {
              name: 'changeSummary',
              type: 'varchar',
              length: '512',
              isNullable: true,
            },
            { name: 'createdBy', type: 'varchar', length: '64' },
            {
              name: 'publishStatus',
              type: 'varchar',
              length: '24',
              default: "'idle'",
            },
            {
              name: 'publishedDocumentId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'publishedLifecycleStatus',
              type: 'varchar',
              length: '24',
              isNullable: true,
            },
            { name: 'publishError', type: 'text', isNullable: true },
            { name: 'publishedAt', type: 'timestamp', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
          foreignKeys: [
            new TableForeignKey({
              name: 'FK_team_wiki_revisions_page',
              columnNames: ['pageId'],
              referencedTableName: 'team_wiki_pages',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            }),
          ],
        }),
      );
      await queryRunner.createIndex(
        'team_wiki_revisions',
        new TableIndex({
          name: 'UQ_team_wiki_revisions_tenant_page_number',
          columnNames: ['tenantId', 'pageId', 'revisionNumber'],
          isUnique: true,
        }),
      );
      await queryRunner.createIndex(
        'team_wiki_revisions',
        new TableIndex({
          name: 'IDX_team_wiki_revisions_page_created',
          columnNames: ['tenantId', 'pageId', 'createdAt'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('team_wiki_revisions')) {
      await queryRunner.dropTable('team_wiki_revisions', true);
    }
    if (await queryRunner.hasTable('team_wiki_pages')) {
      await queryRunner.dropTable('team_wiki_pages', true);
    }
  }
}
