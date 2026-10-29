import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleIncrementalMetadata1788800000000
  implements MigrationInterface
{
  name = 'AddRuleIncrementalMetadata1788800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "ruleKey" varchar(128) NULL',
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "changeType" varchar(24) NOT NULL DEFAULT 'standalone'`,
    );
    await queryRunner.query(
      'ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "supersedesChunkId" varchar(64) NULL',
    );
    await queryRunner.query(
      `ALTER TABLE "documents_meta" ADD COLUMN IF NOT EXISTS "changeType" varchar(24) NOT NULL DEFAULT 'standalone'`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_document_chunks_rule_key" ON "document_chunks" ("docId", "ruleKey")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_document_chunks_rule_key"',
    );
    await queryRunner.query(
      'ALTER TABLE "documents_meta" DROP COLUMN IF EXISTS "changeType"',
    );
    await queryRunner.query(
      'ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "supersedesChunkId"',
    );
    await queryRunner.query(
      'ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "changeType"',
    );
    await queryRunner.query(
      'ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "ruleKey"',
    );
  }
}
