import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('trace_spans')
@Index('IDX_trace_spans_trace_created', ['traceId', 'createdAt'])
@Index('IDX_trace_spans_kind_created', ['kind', 'createdAt'])
export class TraceSpanEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Index('IDX_trace_spans_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  traceId!: string;

  @Column({ type: 'varchar', length: 64 })
  spanId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  parentSpanId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  method!: string;

  @Column({ type: 'varchar', length: 255 })
  route!: string;

  @Column({ type: 'int' })
  status!: number;

  // Keep sub-millisecond precision from process.hrtime() for latency dashboards.
  @Column({ type: 'double precision' })
  durationMs!: number;

  @Column({ type: 'timestamp' })
  startedAt!: Date;

  @Column({ type: 'varchar', length: 16, default: 'http' })
  kind!: 'http' | 'agent_node';

  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  alert!: 'span_limit' | null;

  @CreateDateColumn()
  createdAt!: Date;
}
