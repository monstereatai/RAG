import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type TeamWikiPublishStatus =
  | 'idle'
  | 'publishing'
  | 'published'
  | 'failed';

@Entity('team_wiki_revisions')
@Index(
  'UQ_team_wiki_revisions_tenant_page_number',
  ['tenantId', 'pageId', 'revisionNumber'],
  { unique: true },
)
@Index('IDX_team_wiki_revisions_page_created', [
  'tenantId',
  'pageId',
  'createdAt',
])
export class TeamWikiRevisionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  pageId!: string;

  @Column({ type: 'int' })
  revisionNumber!: number;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'text' })
  referencesJson!: string;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  changeSummary!: string | null;

  @Column({ type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ type: 'varchar', length: 24, default: 'idle' })
  publishStatus!: TeamWikiPublishStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  publishedDocumentId!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true, default: null })
  publishedLifecycleStatus!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  publishError!: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  publishedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
