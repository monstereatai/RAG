import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddAgentCollaboration1786600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({ name: 'agent_sops', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'key', type: 'varchar', length: '64', isUnique: true }, { name: 'role', type: 'varchar', length: '64' }, { name: 'name', type: 'varchar', length: '128' }, { name: 'version', type: 'int', default: 1 }, { name: 'status', type: 'varchar', length: '32', default: "'published'" }, { name: 'inputContract', type: 'text', default: "'[]'" }, { name: 'actions', type: 'text', default: "'[]'" }, { name: 'outputContract', type: 'text', default: "'[]'" }, { name: 'dependencies', type: 'text', default: "'[]'" }, { name: 'maxSteps', type: 'int', default: 6 }, { name: 'createdAt', type: 'timestamp', default: 'now()' }, { name: 'updatedAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('agent_sops', new TableIndex({ name: 'IDX_agent_sops_role_status', columnNames: ['role', 'status'] }));
    await q.createTable(new Table({ name: 'agent_collaboration_messages', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'threadId', type: 'varchar', length: '64' }, { name: 'runId', type: 'varchar', length: '64', isNullable: true }, { name: 'fromRole', type: 'varchar', length: '64' }, { name: 'toRole', type: 'varchar', length: '64' }, { name: 'messageType', type: 'varchar', length: '64' }, { name: 'subject', type: 'varchar', length: '128' }, { name: 'payload', type: 'text', default: "'{}'" }, { name: 'artifactIds', type: 'text', default: "'[]'" }, { name: 'status', type: 'varchar', length: '32', default: "'published'" }, { name: 'createdAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('agent_collaboration_messages', new TableIndex({ name: 'IDX_agent_messages_thread_created', columnNames: ['threadId', 'createdAt'] }));
    await q.createTable(new Table({ name: 'artifact_dependencies', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'threadId', type: 'varchar', length: '64' }, { name: 'artifactId', type: 'varchar', length: '128' }, { name: 'dependsOnArtifactId', type: 'varchar', length: '128' }, { name: 'relation', type: 'varchar', length: '32', default: "'input'" }, { name: 'createdAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('artifact_dependencies', new TableIndex({ name: 'IDX_artifact_dependencies_thread', columnNames: ['threadId', 'createdAt'] }));
    await q.createIndex('artifact_dependencies', new TableIndex({ name: 'IDX_artifact_dependencies_artifact', columnNames: ['artifactId'] }));
    await q.createTable(new Table({ name: 'decision_records', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true }, { name: 'threadId', type: 'varchar', length: '64' }, { name: 'projectId', type: 'varchar', length: '128', isNullable: true }, { name: 'title', type: 'varchar', length: '256' }, { name: 'status', type: 'varchar', length: '32', default: "'draft'" }, { name: 'conflicts', type: 'text', default: "'[]'" }, { name: 'options', type: 'text', default: "'[]'" }, { name: 'decision', type: 'text', default: "'{}'" }, { name: 'rationale', type: 'text', default: "''" }, { name: 'sourceArtifactIds', type: 'text', default: "'[]'" }, { name: 'createdBy', type: 'varchar', length: '64', isNullable: true }, { name: 'approvedBy', type: 'varchar', length: '64', isNullable: true }, { name: 'createdAt', type: 'timestamp', default: 'now()' }, { name: 'updatedAt', type: 'timestamp', default: 'now()' },
    ] }), true);
    await q.createIndex('decision_records', new TableIndex({ name: 'IDX_decision_records_thread_created', columnNames: ['threadId', 'createdAt'] }));
  }

  async down(q: QueryRunner): Promise<void> {
    await q.dropTable('decision_records', true);
    await q.dropTable('artifact_dependencies', true);
    await q.dropTable('agent_collaboration_messages', true);
    await q.dropTable('agent_sops', true);
  }
}
