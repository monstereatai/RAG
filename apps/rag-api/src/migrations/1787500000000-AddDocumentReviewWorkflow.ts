import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentReviewWorkflow1787500000000 implements MigrationInterface {
  name = 'AddDocumentReviewWorkflow1787500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('documents_meta');
    if (table && !table.findColumnByName('reviewStatus')) {
      await queryRunner.query(
        'ALTER TABLE "documents_meta" ADD COLUMN "reviewStatus" varchar(24) NOT NULL DEFAULT \'approved\'',
      );
      await queryRunner.query(
        'ALTER TABLE "documents_meta" ADD COLUMN "reviewedBy" varchar(64) NULL',
      );
      await queryRunner.query(
        'ALTER TABLE "documents_meta" ADD COLUMN "reviewedAt" timestamp NULL',
      );
      await queryRunner.query(
        'ALTER TABLE "documents_meta" ADD COLUMN "reviewComment" text NULL',
      );
      await queryRunner.query(
        'CREATE INDEX "IDX_documents_meta_review" ON "documents_meta" ("reviewStatus")',
      );
    }
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "document_reviews" (
      "id" varchar(64) PRIMARY KEY,
      "docId" varchar(64) NOT NULL,
      "action" varchar(24) NOT NULL,
      "operatorId" varchar(64) NULL,
      "comment" text NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_document_reviews_doc_created" ON "document_reviews" ("docId", "createdAt")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "document_reviews"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_documents_meta_review"');
    await queryRunner.query(
      'ALTER TABLE "documents_meta" DROP COLUMN IF EXISTS "reviewComment"',
    );
    await queryRunner.query(
      'ALTER TABLE "documents_meta" DROP COLUMN IF EXISTS "reviewedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "documents_meta" DROP COLUMN IF EXISTS "reviewedBy"',
    );
    await queryRunner.query(
      'ALTER TABLE "documents_meta" DROP COLUMN IF EXISTS "reviewStatus"',
    );
  }
}
