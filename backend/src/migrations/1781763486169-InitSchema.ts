import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1781763486169 implements MigrationInterface {
  name = 'InitSchema1781763486169';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" character varying(64) NOT NULL, "username" character varying(64) NOT NULL, "passwordHash" character varying(255) NOT NULL, "role" character varying(32) NOT NULL DEFAULT 'user', "tenantId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" character varying(64) NOT NULL, "userId" character varying(64), "title" character varying(100) NOT NULL DEFAULT '', "mode" character varying(16) NOT NULL DEFAULT 'auto', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" character varying(64) NOT NULL, "conversationId" character varying(64) NOT NULL, "role" character varying(8) NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_751332fc6cc6fc576c6975cd07" ON "messages" ("conversationId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "documents_meta" ("docId" character varying(64) NOT NULL, "filename" character varying(512) NOT NULL, "chunkCount" integer NOT NULL DEFAULT '0', "userId" character varying(64), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8e92a5175e1dbdb483d52cb8cd5" PRIMARY KEY ("docId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "documents_meta"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_751332fc6cc6fc576c6975cd07"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
