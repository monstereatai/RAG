import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ApiTokenService } from './api-token.service';
import { AuthUserStore } from './auth-user.store';
import { TokenStoreService } from './token-store/token-store.service';
import { MailModule } from '../mail/mail.module';
import { SseTicketService } from './sse-ticket.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { ApiTokenAccessGuard } from '../../common/guards/api-token-access.guard';
import { SpeechTicketService } from './speech-ticket.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    // 邮件能力（激活 / 验证码邮件）；未配置 SMTP 时 MailService 走本地模拟
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.get<string>('auth.jwtSecret'),
          signOptions: {
            expiresIn: config.get<string>('auth.jwtExpiresIn') ?? '7d',
          },
        }) as unknown as JwtModuleOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ApiTokenService,
    AuthUserStore,
    TokenStoreService,
    SseTicketService,
    SpeechTicketService,
    JwtAuthGuard,
    ServiceTokenGuard,
    ApiTokenAccessGuard,
  ],
  exports: [
    AuthService,
    ApiTokenService,
    AuthUserStore,
    SseTicketService,
    SpeechTicketService,
    JwtAuthGuard,
    ServiceTokenGuard,
    ApiTokenAccessGuard,
    JwtModule,
  ],
})
export class AuthModule {}
