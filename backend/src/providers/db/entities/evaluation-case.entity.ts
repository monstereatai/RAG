import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('evaluation_cases')
@Index('IDX_evaluation_cases_source', ['sourceFeedbackId'])
@Index('IDX_evaluation_cases_status', ['status', 'createdAt'])
export class EvaluationCaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null }) sourceFeedbackId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true, default: null }) workspaceId!: string | null;
  @Column({ type: 'text' }) query!: string;
  @Column({ type: 'text' }) expectedAnswer!: string;
  @Column({ type: 'text', default: '[]' }) expectedReferences!: string;
  @Column({ type: 'varchar', length: 32, default: 'active' }) status!: 'active' | 'disabled';
  @Column({ type: 'varchar', length: 64, nullable: true, default: null }) createdBy!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
