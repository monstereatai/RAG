import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ArtifactKind =
  | 'markdown'
  | 'word'
  | 'excel'
  | 'architecture'
  | 'image';
export type ArtifactStatus = 'queued' | 'generating' | 'ready' | 'failed';

@Entity('generated_artifacts')
@Index('IDX_generated_artifacts_owner_created', ['ownerUserId', 'createdAt'])
@Index('IDX_generated_artifacts_thread', ['threadId'])
@Index('IDX_generated_artifacts_status', ['status'])
export class GeneratedArtifactEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  ownerUserId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  threadId!: string | null;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: ArtifactKind;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status!: ArtifactStatus;

  @Column({ type: 'varchar', length: 512 })
  filename!: string;

  @Column({ type: 'text' })
  sourceText!: string;

  @Column({ type: 'text', nullable: true, default: null })
  prompt!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true, default: null })
  objectKey!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true, default: null })
  storageUrl!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  contentType!: string | null;

  @Column({ type: 'int', default: 0 })
  size!: number;

  @Column({ type: 'text', nullable: true, default: null })
  metadata!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
