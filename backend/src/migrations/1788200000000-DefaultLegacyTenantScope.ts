import { MigrationInterface, QueryRunner } from 'typeorm';

/** 让旧调用方在尚未显式传递租户时安全落到 legacy，而不是产生无租户资源。 */
export class DefaultLegacyTenantScope1788200000000 implements MigrationInterface {
  private readonly tables = [
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

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    for (const table of this.tables) {
      if (!(await queryRunner.hasTable(table))) continue;
      const metadata = await queryRunner.getTable(table);
      if (!metadata?.findColumnByName('tenantId')) continue;
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "tenantId" SET DEFAULT 'legacy'`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return;
    for (const table of this.tables) {
      if (!(await queryRunner.hasTable(table))) continue;
      const metadata = await queryRunner.getTable(table);
      if (!metadata?.findColumnByName('tenantId')) continue;
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "tenantId" DROP DEFAULT`,
      );
    }
  }
}
