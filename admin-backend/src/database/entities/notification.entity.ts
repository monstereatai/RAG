import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 32, default: 'system' })
  type!: 'system' | 'info' | 'warning' | 'error';

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text', nullable: true, default: null })
  message!: string | null;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  userId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
