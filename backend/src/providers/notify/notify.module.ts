import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DingTalkProvider } from './dingtalk.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [DingTalkProvider],
  exports: [DingTalkProvider],
})
export class NotifyModule {}
