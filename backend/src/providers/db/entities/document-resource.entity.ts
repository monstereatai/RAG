import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('document_resources')
@Index('IDX_document_resources_doc', ['docId'])
@Index('IDX_document_resources_user', ['userId'])
export class DocumentResourceEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;
  @Index('IDX_document_resources_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  docId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  taskId!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  kind!: 'original' | 'derived' | 'frame' | 'transcript';

  @Column({ type: 'varchar', length: 512 })
  filename!: string;

  @Column({ type: 'varchar', length: 1024 })
  objectKey!: string;

  @Column({ type: 'varchar', length: 1024 })
  url!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, default: null })
  contentType!: string | null;

  @Column({ type: 'int', default: 0 })
  size!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
