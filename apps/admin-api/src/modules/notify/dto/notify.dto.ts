import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendCodeDto {
  @ApiProperty({ description: '接收验证码的邮箱', example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
