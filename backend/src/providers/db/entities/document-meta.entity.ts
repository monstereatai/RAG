import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 文档元数据表
 * 持久化文档的上传信息（补充内存 Map，重启后恢复）。
 * 包含 LLM 自动抽取的元数据（title/author/summary/keywords/language/category）。
 */
@Entity('documents_meta')
@Index('IDX_documents_meta_project_activity', ['projectId', 'activityId'])
@Index('IDX_documents_meta_lifecycle', ['lifecycleStatus'])
export class DocumentMetaEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 512 })
  filename!: string;

  @Column({ type: 'int', default: 0 })
  chunkCount!: number;

  /** 关联用户（单租户时为空） */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  // ========== LLM 抽取的元数据 ==========

  /** 文档标题（LLM 抽取或从文件名推断） */
  @Column({ type: 'varchar', length: 256, nullable: true, default: null })
  title!: string | null;

  /** 作者（LLM 抽取） */
  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  author!: string | null;

  /** 内容摘要（LLM 抽取，100字以内） */
  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  summary!: string | null;

  /** 关键词（LLM 抽取，JSON 数组字符串） */
  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  keywords!: string | null;

  /** 语言（LLM 抽取，如"中文"、"英文"） */
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  language!: string | null;

  /** 文档类别（LLM 抽取，如"技术文档"、"教程"） */
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  category!: string | null;

  /** 文档版本，用于多版本事实治理 */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  docVersion!: string | null;

  /** 文档生效时间 */
  @Column({ type: 'timestamp', nullable: true, default: null })
  effectiveAt!: Date | null;

  /** 文档失效时间 */
  @Column({ type: 'timestamp', nullable: true, default: null })
  expiredAt!: Date | null;

  /** 来源权威级别：official / draft / normal / deprecated */
  @Column({ type: 'varchar', length: 32, default: 'normal' })
  sourceAuthority!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  projectId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  activityId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  region!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  locale!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  channel!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  roleScope!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'general' })
  documentType!: string;

  @Column({ type: 'varchar', length: 32, default: 'effective' })
  lifecycleStatus!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  supersedesDocId!: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  ingestionQuality!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
