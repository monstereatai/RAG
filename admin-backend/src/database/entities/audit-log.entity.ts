import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100, comment: '操作模块' })
  module!: string;

  @Column({ length: 50, comment: '操作类型' })
  action!: string;

  @Column({ nullable: true, comment: '操作人ID' })
  userId!: string;

  @Column({ nullable: true, comment: '操作人名称' })
  username!: string;

  @Column({ type: 'text', nullable: true, comment: '请求参数' })
  requestData!: string;

  @Column({ type: 'text', nullable: true, comment: '响应结果' })
  responseData!: string;

  @Column({ length: 50, nullable: true, comment: 'IP地址' })
  ip!: string;

  @Column({ length: 100, nullable: true, comment: '链路追踪ID' })
  traceId!: string;

  @CreateDateColumn({ comment: '记录时间' })
  createdAt!: Date;
}
