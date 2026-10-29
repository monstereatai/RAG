import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({ description: '用户 ID', example: '1' })
  @IsString()
  @IsNotEmpty({ message: '用户 ID 不能为空' })
  userId: string;

  @ApiProperty({ description: '订单金额（分）', example: 9900 })
  @IsNumber({}, { message: 'amount 必须是数字' })
  @IsPositive({ message: 'amount 必须大于 0' })
  amount: number;

  @ApiPropertyOptional({
    description: '订单明细',
    type: 'array',
    items: { type: 'object' },
    example: [{ productId: 'prod_001', qty: 2 }],
  })
  @IsOptional()
  @IsArray()
  items?: Array<{ productId: string; qty: number }>;
}
