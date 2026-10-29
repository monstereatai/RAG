import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('iam_permissions')
@Index('UQ_iam_permissions_code', ['code'], { unique: true })
export class IamPermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ type: 'varchar', length: 128 }) code!: string;
  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  description!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
