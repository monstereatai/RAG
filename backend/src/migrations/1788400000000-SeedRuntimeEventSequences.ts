import { MigrationInterface, QueryRunner } from 'typeorm';

/** 将迁移前的运行事件最大序号装载到序列表，避免新事件从 1 重新开始。 */
export class SeedRuntimeEventSequences1788400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    if (
      queryRunner.connection.options.type !== 'postgres' ||
      !(await queryRunner.hasTable('agent_runtime_events')) ||
      !(await queryRunner.hasTable('agent_runtime_event_sequences'))
    ) {
      return;
    }
    await queryRunner.query(
      `INSERT INTO "agent_runtime_event_sequences" ("id", "tenantId", "threadId", "nextSequence")
       SELECT md5("tenantId" || ':' || "threadId"), "tenantId", "threadId", MAX("sequence")
       FROM "agent_runtime_events"
       GROUP BY "tenantId", "threadId"
       ON CONFLICT ("tenantId", "threadId") DO UPDATE
       SET "nextSequence" = GREATEST("agent_runtime_event_sequences"."nextSequence", EXCLUDED."nextSequence")`,
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // 序列表属于运行时治理状态，回滚迁移不删除已经观察到的最大序号。
  }
}
