import { IsString, IsNotEmpty, IsNumber, IsPositive, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ description: '订单 ID', example: '1' })
  @IsString()
  @IsNotEmpty({ message: '订单 ID 不能为空' })
  orderId: string;

  @ApiProperty({ description: '用户 ID', example: '1' })
  @IsString()
  @IsNotEmpty({ message: '用户 ID 不能为空' })
  userId: string;

  @ApiProperty({ description: '支付金额（分）', example: 9900 })
  @IsNumber({}, { message: 'amount 必须是数字' })
  @IsPositive({ message: 'amount 必须大于 0' })
  amount: number;

  @ApiProperty({
    description: '支付方式',
    enum: ['credit_card', 'paypal', 'alipay', 'wechat_pay'],
    example: 'alipay',
  })
  @IsString()
  @IsIn(['credit_card', 'paypal', 'alipay', 'wechat_pay'], {
    message: '支付方式不合法',
  })
  method: string;
}
