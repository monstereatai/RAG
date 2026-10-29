import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('workflow_template_versions')
@Index('IDX_workflow_template_versions_template', ['templateId', 'version'], {
  unique: true,
})
export class WorkflowTemplateVersionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Index('IDX_workflow_template_versions_tenant')
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  tenantId!: string | null;
  @Column({ type: 'varchar', length: 64 }) templateId!: string;
  @Column({ type: 'int' }) version!: number;
  @Column({ type: 'text' }) definition!: string;
  @Column({ type: 'varchar', length: 32, default: 'draft' }) status!:
    | 'draft'
    | 'published'
    | 'rolled_back';
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  createdBy!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
