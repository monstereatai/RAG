import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledJobVersions1787400000000 implements MigrationInterface {
  name = 'AddScheduledJobVersions1787400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduled_jobs');
    if (!table) return;
    const add = async (sql: string) => queryRunner.query(sql);
    if (!table.findColumnByName('versionGroupId')) {
      await add(
        'ALTER TABLE "scheduled_jobs" ADD COLUMN "versionGroupId" varchar(64) NULL',
      );
    }
    if (!table.findColumnByName('version')) {
      await add(
        'ALTER TABLE "scheduled_jobs" ADD COLUMN "version" integer NOT NULL DEFAULT 1',
      );
    }
    if (!table.findColumnByName('isCurrent')) {
      await add(
        'ALTER TABLE "scheduled_jobs" ADD COLUMN "isCurrent" boolean NOT NULL DEFAULT true',
      );
    }
    if (!table.findColumnByName('copiedFromId')) {
      await add(
        'ALTER TABLE "scheduled_jobs" ADD COLUMN "copiedFromId" varchar(64) NULL',
      );
    }
    await queryRunner.query(
      'UPDATE "scheduled_jobs" SET "versionGroupId" = "id" WHERE "versionGroupId" IS NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "scheduled_jobs" DROP COLUMN IF EXISTS "copiedFromId"',
    );
    await queryRunner.query(
      'ALTER TABLE "scheduled_jobs" DROP COLUMN IF EXISTS "isCurrent"',
    );
    await queryRunner.query(
      'ALTER TABLE "scheduled_jobs" DROP COLUMN IF EXISTS "version"',
    );
    await queryRunner.query(
      'ALTER TABLE "scheduled_jobs" DROP COLUMN IF EXISTS "versionGroupId"',
    );
  }
}
