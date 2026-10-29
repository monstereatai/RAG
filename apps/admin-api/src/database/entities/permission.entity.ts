import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 50, comment: '权限名称' })
  name!: string;

  @Column({ length: 50, unique: true, comment: '权限代码' })
  code!: string;

  @Column({ length: 100, comment: '权限描述' })
  description!: string;
}
