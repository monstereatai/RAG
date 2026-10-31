import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddFeishuWikiSync1788700000000 implements MigrationInterface {
  name = 'AddFeishuWikiSync1788700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('feishu_wiki_connectors'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_wiki_connectors',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'ownerUserId', type: 'varchar', length: '64' },
            { name: 'spaceId', type: 'varchar', length: '128' },
            {
              name: 'status',
              type: 'varchar',
              length: '16',
              default: "'idle'",
            },
            { name: 'shareWithinTenant', type: 'boolean', default: false },
            { name: 'lastSyncAt', type: 'timestamp', isNullable: true },
            { name: 'lastError', type: 'text', isNullable: true },
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
      await queryRunner.createIndex(
        'feishu_wiki_connectors',
        new TableIndex({
          name: 'UQ_feishu_wiki_connectors_tenant_space',
          columnNames: ['tenantId', 'spaceId'],
          isUnique: true,
        }),
      );
    }

    if (!(await queryRunner.hasTable('feishu_wiki_items'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_wiki_items',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'connectorId', type: 'varchar', length: '64' },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'nodeToken', type: 'varchar', length: '128' },
            {
              name: 'objectToken',
              type: 'varchar',
              length: '128',
              isNullable: true,
            },
            {
              name: 'objectType',
              type: 'varchar',
              length: '32',
              isNullable: true,
            },
            { name: 'title', type: 'varchar', length: '512' },
            {
              name: 'remoteRevisionId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'contentHash',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            {
              name: 'localDocId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'active', type: 'boolean', default: true },
            { name: 'lastSeenAt', type: 'timestamp', isNullable: true },
            { name: 'deletedAt', type: 'timestamp', isNullable: true },
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
      await queryRunner.createForeignKey(
        'feishu_wiki_items',
        new TableForeignKey({
          name: 'FK_feishu_wiki_items_connector',
          columnNames: ['connectorId'],
          referencedTableName: 'feishu_wiki_connectors',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
      await queryRunner.createIndices('feishu_wiki_items', [
        new TableIndex({
          name: 'UQ_feishu_wiki_items_connector_node',
          columnNames: ['connectorId', 'nodeToken'],
          isUnique: true,
        }),
        new TableIndex({
          name: 'IDX_feishu_wiki_items_tenant_active',
          columnNames: ['tenantId', 'active'],
        }),
      ]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('feishu_wiki_items')) {
      await queryRunner.dropTable('feishu_wiki_items');
    }
    if (await queryRunner.hasTable('feishu_wiki_connectors')) {
      await queryRunner.dropTable('feishu_wiki_connectors');
    }
  }
}
