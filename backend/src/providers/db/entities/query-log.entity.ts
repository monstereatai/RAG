import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('query_logs')
@Index('IDX_query_logs_user', ['userId'])
@Index('IDX_query_logs_created', ['createdAt'])
@Index('IDX_query_logs_mode', ['mode'])
export class QueryLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'text' })
  query!: string;

  @Column({ type: 'varchar', length: 32, default: 'simple' })
  mode!: 'simple' | 'agentic' | 'auto';

  @Column({ type: 'boolean', default: false })
  refused!: boolean;

  @Column({ type: 'int', default: 0 })
  citationCount!: number;

  @Column({ type: 'int', default: 0 })
  latencyMs!: number;

  @Column({ type: 'int', nullable: true, default: null })
  llmTokensEstimated!: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  threadId!: string | null;

  @Column({ type: 'boolean', default: false })
  hasAnswer!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
