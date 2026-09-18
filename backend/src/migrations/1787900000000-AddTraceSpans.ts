import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from 'typeorm';

export class AddTraceSpans1787900000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('trace_spans'))) {
      await q.createTable(
        new Table({
          name: 'trace_spans',
          columns: [
            { name: 'id', type: 'varchar', length: '64', isPrimary: true },
            { name: 'traceId', type: 'varchar', length: '64' },
            { name: 'spanId', type: 'varchar', length: '64' },
            {
              name: 'parentSpanId',
              type: 'varchar',
              length: '64',
              isNullable: true,
              default: 'NULL',
            },
            { name: 'method', type: 'varchar', length: '16' },
            { name: 'route', type: 'varchar', length: '255' },
            { name: 'status', type: 'int' },
            { name: 'durationMs', type: 'int' },
            { name: 'startedAt', type: 'timestamp' },
            { name: 'kind', type: 'varchar', length: '16', default: "'http'" },
            {
              name: 'alert',
              type: 'varchar',
              length: '32',
              isNullable: true,
              default: 'NULL',
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      );
    }

    const table = await q.getTable('trace_spans');
    if (!table) return;
    if (!table.indices.some((index) => index.name === 'IDX_trace_spans_trace_created')) {
      await q.createIndex(
        'trace_spans',
        new TableIndex({
          name: 'IDX_trace_spans_trace_created',
          columnNames: ['traceId', 'createdAt'],
        }),
      );
    }
    if (!table.indices.some((index) => index.name === 'IDX_trace_spans_kind_created')) {
      await q.createIndex(
        'trace_spans',
        new TableIndex({
          name: 'IDX_trace_spans_kind_created',
          columnNames: ['kind', 'createdAt'],
        }),
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    if (await q.hasTable('trace_spans')) {
      await q.dropTable('trace_spans');
    }
  }
}
