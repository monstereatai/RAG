import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workflow_templates')
@Index('IDX_workflow_templates_workspace_key', ['workspaceId', 'key'], {
  unique: true,
})
export class WorkflowTemplateEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Index('IDX_workflow_templates_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;
  @Column({ type: 'varchar', length: 128 }) key!: string;
  @Column({ type: 'varchar', length: 255 }) name!: string;
  @Column({ type: 'text', nullable: true, default: null }) description!:
    | string
    | null;
  @Column({ type: 'varchar', length: 64, default: 'default' })
  workspaceId!: string;
  @Column({ type: 'varchar', length: 32, default: 'draft' }) status!:
    | 'draft'
    | 'published'
    | 'archived';
  @Column({ type: 'int', default: 0 }) activeVersion!: number;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  ownerId!: string | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
