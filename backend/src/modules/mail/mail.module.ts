import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';

/**
 * 邮件模块
 *
 * 导出 MailService 供认证（激活 / 验证码）及其他业务模块复用；
 * 未配置 SMTP 时自动进入本地模拟模式（详见 mail.service.ts）。
 */
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
