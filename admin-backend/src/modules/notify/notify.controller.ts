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

  @Post('operations-alert')
  @RequireLogin()
  @ApiOperation({ summary: '发送运营告警到企业微信或本地模拟通道' })
  async sendOperationsAlert(
    @Body()
    body: {
      title: string;
      severity: 'info' | 'warning' | 'critical';
      summary: string;
      traceId?: string;
      incidentId?: string;
    },
  ) {
    return this.notifyService.sendOperationsAlert(body);
  }
}
