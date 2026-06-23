import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { NotifyService } from './notify.service';
import { NotifyController } from './notify.controller';
import { NotifyProcessor } from './notify.processor';
import { NotifyGateway } from './notify.gateway';
import { QueueModule } from '../../queue/queue.module';
import { CacheModule } from '../cache/cache.module';

const notifyGatewayProvider = process.env.NODE_ENV === 'test'
  ? {
      provide: NotifyGateway,
      useValue: {
        sendToAll: () => undefined,
        sendToUser: () => undefined,
      },
    }
  : NotifyGateway;

@Module({
  imports: [
    ConfigModule,
    QueueModule,
    CacheModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST', 'smtp.example.com'),
          port: config.get<number>('SMTP_PORT', 587),
          auth: {
            user: config.get('SMTP_USER', 'user'),
            pass: config.get('SMTP_PASS', 'pass'),
          },
        },
        defaults: {
          from: '"No Reply" <noreply@example.com>',
        },
      }),
    }),
  ],
  controllers: [NotifyController],
  providers: [NotifyService, NotifyProcessor, notifyGatewayProvider],
  exports: [NotifyService, NotifyGateway],
})
export class NotifyModule {}
