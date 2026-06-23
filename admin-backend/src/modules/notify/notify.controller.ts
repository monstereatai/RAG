import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotifyService } from './notify.service';
import { SendCodeDto } from './dto/notify.dto';
import { RequireLogin } from '../../common/decorators/require-login.decorator';

@ApiTags('notify')
@Controller('notify')
export class NotifyController {
  constructor(private readonly notifyService: NotifyService) {}

  @Post('email/code')
  @RequireLogin(false)
  @ApiOperation({ summary: '发送邮箱验证码 (异步队列)' })
  async sendEmailCode(@Body() sendCodeDto: SendCodeDto) {
    return this.notifyService.sendVerificationCode(sendCodeDto.email);
  }
}
