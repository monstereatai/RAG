import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOrderStatusDto {
  @ApiProperty({ description: '订单状态', example: 'paid' })
  @IsString({ message: 'status 必须为字符串' })
  @IsNotEmpty({ message: '订单状态不能为空' })
  status: string;
}
