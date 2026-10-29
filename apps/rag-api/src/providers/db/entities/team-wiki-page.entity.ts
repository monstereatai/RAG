import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('team_wiki_pages')
@Index('IDX_team_wiki_pages_tenant_updated', ['tenantId', 'updatedAt'])
export class TeamWikiPageEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  currentRevisionId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  lastPublishedRevisionId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ type: 'varchar', length: 64 })
  updatedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt!: Date | null;
}
