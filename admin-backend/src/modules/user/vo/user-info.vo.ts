import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

export class UserInfoVo {
  @ApiProperty({ description: '用户 ID' })
  @Expose()
  id: number;

  @ApiProperty({ description: '用户名' })
  @Expose()
  username: string;

  @ApiProperty({ description: '邮箱' })
  @Expose()
  email: string;

  @ApiProperty({ description: '角色' })
  @Expose()
  role: string;

  @ApiProperty({ description: '是否活跃' })
  @Expose()
  isActive: boolean;

  @ApiProperty({ description: '创建时间' })
  @Expose()
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @Expose()
  updatedAt: Date;

  @Exclude()
  password?: string;
}
