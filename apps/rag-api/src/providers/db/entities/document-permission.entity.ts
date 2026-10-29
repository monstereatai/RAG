import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('document_permissions')
@Index('IDX_document_permissions_subject', ['subjectType', 'subjectId'])
@Index('IDX_document_permissions_doc', ['docId'])
export class DocumentPermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;
  @Index('IDX_document_permissions_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  docId!: string;

  @Column({ type: 'varchar', length: 16 })
  subjectType!: 'user' | 'role' | 'department' | 'public';

  @Column({ type: 'varchar', length: 128 })
  subjectId!: string;

  @Column({ type: 'varchar', length: 16, default: 'read' })
  action!: 'read' | 'write' | 'admin';

  @CreateDateColumn()
  createdAt!: Date;
}
