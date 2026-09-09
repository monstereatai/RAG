import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agent_sops')
@Index('IDX_agent_sops_role_status', ['role', 'status'])
export class AgentSopEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 64, unique: true }) key!: string;
  @Column({ type: 'varchar', length: 64 }) role!: string;
  @Column({ type: 'varchar', length: 128 }) name!: string;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ type: 'varchar', length: 32, default: 'published' })
  status!: string;
  @Column({ type: 'text', default: '[]' }) inputContract!: string;
  @Column({ type: 'text', default: '[]' }) actions!: string;
  @Column({ type: 'text', default: '[]' }) outputContract!: string;
  @Column({ type: 'text', default: '[]' }) dependencies!: string;
  @Column({ type: 'int', default: 6 }) maxSteps!: number;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
