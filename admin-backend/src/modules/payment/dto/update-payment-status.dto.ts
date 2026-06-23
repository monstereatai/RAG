import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePaymentStatusDto {
  @ApiProperty({ description: '支付状态', example: 'success' })
  @IsString({ message: 'status 必须为字符串' })
  @IsNotEmpty({ message: '支付状态不能为空' })
  status: string;

  @ApiPropertyOptional({ description: '交易流水号', example: 'tx_1234567890' })
  @IsString({ message: 'transactionId 必须为字符串' })
  @IsOptional()
  transactionId?: string;
}
