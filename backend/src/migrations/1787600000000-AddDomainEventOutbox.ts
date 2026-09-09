import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDomainEventOutbox1787600000000 implements MigrationInterface {
  name = 'AddDomainEventOutbox1787600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "domain_event_outbox" (
      "id" varchar(64) PRIMARY KEY, "idempotencyKey" varchar(96) NOT NULL UNIQUE,
      "eventType" varchar(96) NOT NULL, "aggregateType" varchar(64) NOT NULL, "aggregateId" varchar(64) NOT NULL,
      "payload" text NOT NULL DEFAULT '{}', "status" varchar(16) NOT NULL DEFAULT 'pending',
      "attempts" integer NOT NULL DEFAULT 0, "maxAttempts" integer NOT NULL DEFAULT 3,
      "availableAt" timestamp NULL, "deliveredAt" timestamp NULL, "lastError" text NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_domain_event_outbox_dispatch" ON "domain_event_outbox" ("status", "availableAt")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_domain_event_outbox_event_created" ON "domain_event_outbox" ("eventType", "createdAt")',
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "domain_event_subscriptions" (
      "id" varchar(64) PRIMARY KEY, "name" varchar(120) NOT NULL, "eventTypes" text NOT NULL,
      "channel" varchar(32) NOT NULL, "endpointKey" varchar(128) NOT NULL, "enabled" boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_domain_event_subscriptions_enabled" ON "domain_event_subscriptions" ("enabled", "channel")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "domain_event_subscriptions"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "domain_event_outbox"');
  }
}
