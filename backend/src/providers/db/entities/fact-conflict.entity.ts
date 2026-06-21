import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('fact_conflicts')
@Index('IDX_fact_conflicts_user_subject', ['userId', 'subject'])
@Index('IDX_fact_conflicts_doc', ['docId'])
export class FactConflictEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  chunkId!: string | null;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Column({ type: 'varchar', length: 128 })
  predicate!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  currentValue!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  conflictingValue!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  currentVersion!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  conflictingVersion!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'detected' })
  status!: 'detected' | 'resolved' | 'ignored';

  @Column({ type: 'varchar', length: 32, default: 'normal' })
  sourceAuthority!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
