import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHypotheticalQuestions1787700000000
  implements MigrationInterface
{
  name = 'AddHypotheticalQuestions1787700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "hypotheticalQuestions" text NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "hypotheticalQuestions"',
    );
  }
}
