import { Module } from '@nestjs/common';
import { RagClientModule } from '../rag-client/rag-client.module';
import { SpeechTicketController } from './speech-ticket.controller';

@Module({
  imports: [RagClientModule],
  controllers: [SpeechTicketController],
})
export class SpeechTicketModule {}
