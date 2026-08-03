import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type ArtifactShareVisibility = 'internal' | 'external';

@Entity('artifact_shares')
@Index('IDX_artifact_shares_artifact', ['artifactId'])
@Index('IDX_artifact_shares_token', ['tokenHash'], { unique: true })
export class ArtifactShareEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  artifactId!: string;

  @Column({ type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ type: 'varchar', length: 16 })
  visibility!: ArtifactShareVisibility;

  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamp', nullable: true, default: null })
  expiresAt!: Date | null;

  @Column({ type: 'int', nullable: true, default: null })
  maxDownloads!: number | null;

  @Column({ type: 'int', default: 0 })
  downloadCount!: number;

  @Column({ type: 'timestamp', nullable: true, default: null })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
