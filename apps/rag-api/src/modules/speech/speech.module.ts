import { Module } from '@nestjs/common';
import { SpeechController } from './speech.controller';
import { SpeechModule as SpeechProviderModule } from '../../providers/speech/speech.module';

@Module({
  imports: [SpeechProviderModule],
  controllers: [SpeechController],
})
export class SpeechModule {}
