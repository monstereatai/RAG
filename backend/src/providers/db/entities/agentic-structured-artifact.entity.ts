import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('agentic_structured_artifacts')
@Index('IDX_agentic_structured_artifacts_thread', ['threadId', 'createdAt'])
@Index('IDX_agentic_structured_artifacts_user', ['userId', 'createdAt'])
@Index('IDX_agentic_structured_artifacts_type', ['type', 'createdAt'])
export class AgenticStructuredArtifactEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  threadId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 128 })
  artifactId!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: string;

  @Column({ type: 'varchar', length: 64 })
  producer!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 32, default: 'ready_for_review' })
  status!: string;

  @Column({ type: 'text' })
  payload!: string;

  @Column({ type: 'text', nullable: true, default: null })
  sourceDocIds!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
