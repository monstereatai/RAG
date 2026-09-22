import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * 生产治理基础表：租户/IAM、跨实例运行序号、Outbox 订阅投递账本，
 * 以及资源租户回填和文档索引版本字段。
 *
 * 所有资源字段保持 nullable，便于旧数据和未迁移的后台任务平滑过渡；
 * 已有记录统一回填到 legacy 租户，后续由应用层按租户上下文收紧写入。
 */
export class AddTenantIamRuntimeGovernance1788100000000 implements MigrationInterface {
  private readonly resourceTables = [
    'conversations',
    'messages',
    'documents_meta',
    'document_chunks',
    'fact_conflicts',
    'scheduled_jobs',
    'job_executions',
    'document_tasks',
    'document_reviews',
    'document_resources',
    'document_permissions',
    'query_logs',
    'weekly_summaries',
    'rag_feedback',
    'generated_artifacts',
    'artifact_shares',
    'artifact_access_logs',
    'agentic_structured_artifacts',
    'workflow_templates',
    'workflow_template_versions',
    'agent_runs',
    'agent_actions',
    'agent_sops',
    'agent_collaboration_messages',
    'artifact_dependencies',
    'decision_records',
    'agent_tasks',
    'agent_runtime_events',
    'domain_event_outbox',
    'domain_event_subscriptions',
    'trace_spans',
    'evaluation_cases',
    'knowledge_base_profiles',
  ];

  async up(q: QueryRunner): Promise<void> {
    await this.createIamTables(q);
    await this.createRuntimeTables(q);
    await this.addTenantColumns(q);
    await this.backfillTenantColumns(q);
    await this.addDocumentIndexColumns(q);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of ['document_chunks', 'documents_meta']) {
      if (!(await q.hasTable(table))) continue;
      const current = await q.getTable(table);
      for (const name of table === 'documents_meta'
        ? ['indexGeneration', 'contentHash', 'tenantId']
        : ['indexGeneration', 'contentHash', 'tenantId']) {
        const column = current?.findColumnByName(name);
        if (column) await q.dropColumn(table, column);
      }
    }
    for (const tableName of this.resourceTables) {
      if (!(await q.hasTable(tableName))) continue;
      const table = await q.getTable(tableName);
      const column = table?.findColumnByName('tenantId');
      if (column) await q.dropColumn(tableName, column);
    }
    for (const tableName of [
      'domain_event_deliveries',
      'agent_runtime_event_sequences',
      'iam_membership_roles',
      'iam_role_permissions',
      'iam_permissions',
      'iam_roles',
      'iam_memberships',
      'iam_tenants',
    ]) {
      if (await q.hasTable(tableName)) await q.dropTable(tableName, true);
    }
  }

  private async createIamTables(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('iam_tenants'))) {
      await q.createTable(
        new Table({
          name: 'iam_tenants',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'slug', type: 'varchar', length: '96' },
            { name: 'name', type: 'varchar', length: '160' },
            {
              name: 'status',
              type: 'varchar',
              length: '24',
              default: "'active'",
            },
            { name: 'settings', type: 'text', default: "'{}'" },
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
          indices: [
            new TableIndex({
              name: 'UQ_iam_tenants_slug',
              columnNames: ['slug'],
              isUnique: true,
            }),
          ],
        }),
      );
      await q.query(
        `INSERT INTO ${this.id('iam_tenants')} (${this.id('id')}, ${this.id('slug')}, ${this.id('name')}) VALUES ('legacy', 'legacy', 'Legacy tenant')`,
      );
    }
    if (!(await q.hasTable('iam_memberships'))) {
      await q.createTable(
        new Table({
          name: 'iam_memberships',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'userId', type: 'varchar', length: '64' },
            {
              name: 'status',
              type: 'varchar',
              length: '24',
              default: "'active'",
            },
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
          indices: [
            new TableIndex({
              name: 'UQ_iam_memberships_tenant_user',
              columnNames: ['tenantId', 'userId'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'IDX_iam_memberships_user',
              columnNames: ['userId'],
            }),
          ],
        }),
      );
    }
    if (!(await q.hasTable('iam_roles'))) {
      await q.createTable(
        new Table({
          name: 'iam_roles',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            {
              name: 'tenantId',
              type: 'varchar',
              length: '64',
              isNullable: true,
            },
            { name: 'name', type: 'varchar', length: '96' },
            {
              name: 'description',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            { name: 'isSystem', type: 'boolean', default: false },
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
          indices: [
            new TableIndex({
              name: 'UQ_iam_roles_scope_name',
              columnNames: ['tenantId', 'name'],
              isUnique: true,
            }),
          ],
        }),
      );
    }
    if (!(await q.hasTable('iam_permissions'))) {
      await q.createTable(
        new Table({
          name: 'iam_permissions',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'code', type: 'varchar', length: '128' },
            {
              name: 'description',
              type: 'varchar',
              length: '255',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
          indices: [
            new TableIndex({
              name: 'UQ_iam_permissions_code',
              columnNames: ['code'],
              isUnique: true,
            }),
          ],
        }),
      );
    }
    if (!(await q.hasTable('iam_role_permissions'))) {
      await q.createTable(
        new Table({
          name: 'iam_role_permissions',
          columns: [
            { name: 'roleId', type: 'varchar', length: '64', isPrimary: true },
            {
              name: 'permissionId',
              type: 'varchar',
              length: '64',
              isPrimary: true,
            },
            { name: 'grantedAt', type: 'timestamp', isNullable: true },
          ],
        }),
      );
    }
    if (!(await q.hasTable('iam_membership_roles'))) {
      await q.createTable(
        new Table({
          name: 'iam_membership_roles',
          columns: [
            {
              name: 'membershipId',
              type: 'varchar',
              length: '64',
              isPrimary: true,
            },
            { name: 'roleId', type: 'varchar', length: '64', isPrimary: true },
          ],
        }),
      );
    }
    await this.seedIam(q);
  }

  private async seedIam(q: QueryRunner): Promise<void> {
    const legacyRole = 'legacy-admin';
    const readerRole = 'legacy-reader';
    const permission = 'platform.read';
    await q.query(
      `INSERT INTO ${this.id('iam_roles')} (${this.id('id')}, ${this.id('tenantId')}, ${this.id('name')}, ${this.id('description')}, ${this.id('isSystem')}) VALUES ('${legacyRole}', 'legacy', 'admin', 'Legacy administrator role', ${this.bool(true)}) ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `INSERT INTO ${this.id('iam_roles')} (${this.id('id')}, ${this.id('tenantId')}, ${this.id('name')}, ${this.id('description')}, ${this.id('isSystem')}) VALUES ('${readerRole}', 'legacy', 'reader', 'Legacy read-only role', ${this.bool(true)}) ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `INSERT INTO ${this.id('iam_permissions')} (${this.id('id')}, ${this.id('code')}, ${this.id('description')}) VALUES ('platform-read', '${permission}', 'Read platform resources') ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `INSERT INTO ${this.id('iam_role_permissions')} (${this.id('roleId')}, ${this.id('permissionId')}, ${this.id('grantedAt')}) VALUES ('${legacyRole}', 'platform-read', CURRENT_TIMESTAMP), ('${readerRole}', 'platform-read', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,
    );
    if (await q.hasTable('users')) {
      await q.query(
        `INSERT INTO ${this.id('iam_memberships')} (${this.id('id')}, ${this.id('tenantId')}, ${this.id('userId')}) SELECT CONCAT('legacy-membership-', ${this.id('id')}), 'legacy', ${this.id('id')} FROM ${this.id('users')} u ON CONFLICT DO NOTHING`,
      );
      await q.query(
        `INSERT INTO ${this.id('iam_membership_roles')} (${this.id('membershipId')}, ${this.id('roleId')}) SELECT m.${this.id('id')}, CASE WHEN u.${this.id('role')} = 'admin' THEN '${legacyRole}' ELSE '${readerRole}' END FROM ${this.id('iam_memberships')} m JOIN ${this.id('users')} u ON u.${this.id('id')} = m.${this.id('userId')} WHERE m.${this.id('tenantId')} = 'legacy' ON CONFLICT DO NOTHING`,
      );
    }
  }

  private async createRuntimeTables(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('agent_runtime_event_sequences'))) {
      await q.createTable(
        new Table({
          name: 'agent_runtime_event_sequences',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'threadId', type: 'varchar', length: '64' },
            { name: 'nextSequence', type: 'int', default: 0 },
            {
              name: 'updatedAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
          indices: [
            new TableIndex({
              name: 'UQ_agent_runtime_event_sequences_thread',
              columnNames: ['tenantId', 'threadId'],
              isUnique: true,
            }),
          ],
        }),
      );
    }
    if (!(await q.hasTable('domain_event_deliveries'))) {
      await q.createTable(
        new Table({
          name: 'domain_event_deliveries',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'eventId', type: 'varchar', length: '64' },
            { name: 'subscriptionId', type: 'varchar', length: '64' },
            {
              name: 'status',
              type: 'varchar',
              length: '16',
              default: "'pending'",
            },
            { name: 'attempts', type: 'int', default: 0 },
            { name: 'maxAttempts', type: 'int', default: 3 },
            { name: 'availableAt', type: 'timestamp', isNullable: true },
            { name: 'deliveredAt', type: 'timestamp', isNullable: true },
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
          indices: [
            new TableIndex({
              name: 'UQ_domain_event_deliveries_event_subscription',
              columnNames: ['eventId', 'subscriptionId'],
              isUnique: true,
            }),
            new TableIndex({
              name: 'IDX_domain_event_deliveries_dispatch',
              columnNames: ['status', 'availableAt'],
            }),
          ],
        }),
      );
    }
  }

  private async addTenantColumns(q: QueryRunner): Promise<void> {
    for (const tableName of this.resourceTables) {
      if (!(await q.hasTable(tableName))) continue;
      const table = await q.getTable(tableName);
      if (table?.findColumnByName('tenantId')) continue;
      await q.addColumn(
        tableName,
        new TableColumn({
          name: 'tenantId',
          type: 'varchar',
          length: '64',
          isNullable: true,
          default: null,
        }),
      );
      await q.createIndex(
        tableName,
        new TableIndex({
          name: `IDX_${tableName}_tenant`,
          columnNames: ['tenantId'],
        }),
      );
    }
  }

  private async backfillTenantColumns(q: QueryRunner): Promise<void> {
    for (const tableName of this.resourceTables) {
      if (!(await q.hasTable(tableName))) continue;
      await q.query(
        `UPDATE ${this.id(tableName)} SET ${this.id('tenantId')} = 'legacy' WHERE ${this.id('tenantId')} IS NULL`,
      );
    }
    if (await q.hasTable('users')) {
      await q.query(
        `UPDATE ${this.id('users')} SET ${this.id('tenantId')} = 'legacy' WHERE ${this.id('tenantId')} IS NULL`,
      );
    }
    if (await q.hasTable('agent_runtime_events')) {
      const table = await q.getTable('agent_runtime_events');
      if (
        table &&
        !table.indices.some(
          (index) => index.name === 'UQ_agent_runtime_events_tenant_thread_sequence',
        )
      ) {
        await q.createIndex(
          'agent_runtime_events',
          new TableIndex({
            name: 'UQ_agent_runtime_events_tenant_thread_sequence',
            columnNames: ['tenantId', 'threadId', 'sequence'],
            isUnique: true,
          }),
        );
      }
    }
  }

  private async addDocumentIndexColumns(q: QueryRunner): Promise<void> {
    for (const columnName of ['contentHash', 'indexGeneration']) {
      if (await q.hasTable('documents_meta')) {
        const table = await q.getTable('documents_meta');
        if (!table?.findColumnByName(columnName)) {
          await q.addColumn(
            'documents_meta',
            new TableColumn({
              name: columnName,
              type: 'varchar',
              length: '64',
              isNullable: true,
              default: null,
            }),
          );
        }
      }
      if (await q.hasTable('document_chunks')) {
        const table = await q.getTable('document_chunks');
        if (!table?.findColumnByName(columnName)) {
          await q.addColumn(
            'document_chunks',
            new TableColumn({
              name: columnName,
              type: 'varchar',
              length: '64',
              isNullable: true,
              default: null,
            }),
          );
        }
      }
    }
  }

  private id(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private bool(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }
}
