import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('artifact_dependencies')
@Index('IDX_artifact_dependencies_thread', ['threadId', 'createdAt'])
@Index('IDX_artifact_dependencies_artifact', ['artifactId'])
export class ArtifactDependencyEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64 }) threadId!: string;
  @Column({ type: 'varchar', length: 128 }) artifactId!: string;
  @Column({ type: 'varchar', length: 128 }) dependsOnArtifactId!: string;
  @Column({ type: 'varchar', length: 32, default: 'input' }) relation!: string;
  @CreateDateColumn() createdAt!: Date;
}
