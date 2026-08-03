import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('artifact_access_logs')
@Index('IDX_artifact_access_logs_artifact_created', ['artifactId', 'createdAt'])
@Index('IDX_artifact_access_logs_share', ['shareId'])
export class ArtifactAccessLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  artifactId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  shareId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  action!: 'preview' | 'download';

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  ip!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  userAgent!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
