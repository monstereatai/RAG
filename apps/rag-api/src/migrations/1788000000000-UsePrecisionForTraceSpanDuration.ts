import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

function readColumnDefault(
  value: unknown,
): string | number | boolean | null | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return undefined;
}

export class UsePrecisionForTraceSpanDuration1788000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('trace_spans'))) return;

    const table = await q.getTable('trace_spans');
    const durationColumn = table?.findColumnByName('durationMs');
    if (!durationColumn || durationColumn.type === 'double precision') return;

    await q.changeColumn(
      'trace_spans',
      durationColumn,
      new TableColumn({
        name: 'durationMs',
        type: 'double precision',
        isNullable: durationColumn.isNullable,
        default: readColumnDefault(durationColumn.default),
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('trace_spans'))) return;

    const table = await q.getTable('trace_spans');
    const durationColumn = table?.findColumnByName('durationMs');
    if (!durationColumn || durationColumn.type === 'integer') return;

    await q.changeColumn(
      'trace_spans',
      durationColumn,
      new TableColumn({
        name: 'durationMs',
        type: 'int',
        isNullable: durationColumn.isNullable,
        default: readColumnDefault(durationColumn.default),
      }),
    );
  }
}
