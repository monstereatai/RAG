import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * 文档元数据表
 * 持久化文档的上传信息（补充内存 Map，重启后恢复）。
 */
@Entity('documents_meta')
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

  @CreateDateColumn()
  createdAt!: Date;
}
