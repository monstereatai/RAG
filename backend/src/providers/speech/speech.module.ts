import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TencentSpeechProvider } from './tencent-speech.provider';

export const SPEECH_PROVIDER = 'SPEECH_PROVIDER';

/**
 * Speech Module（腾讯云 ASR/TTS）
 * 全局模块，其他模块可注入 SPEECH_PROVIDER token。
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    TencentSpeechProvider,
    {
      provide: SPEECH_PROVIDER,
      useExisting: TencentSpeechProvider,
    },
  ],
  exports: [TencentSpeechProvider, SPEECH_PROVIDER],
})
export class SpeechModule {}
