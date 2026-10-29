import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable } from 'typeorm';
import { Permission } from './permission.entity';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 50, unique: true, comment: '角色名称' })
  name!: string;

  @Column({ length: 50, unique: true, comment: '角色标识' })
  code!: string;

  @Column({ length: 255, nullable: true, comment: '角色描述' })
  description!: string;

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'role_permissions',
  })
  permissions!: Permission[];
}
