import { IsArray, ArrayNotEmpty, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantUserPermissionsDto {
  @ApiProperty({ description: '要授予的权限 ID 列表', example: [1, 2, 3] })
  @IsArray()
  @ArrayNotEmpty({ message: 'permissionIds 不能为空' })
  @IsInt({ each: true, message: 'permissionIds 必须是整数数组' })
  permissionIds: number[];
}
