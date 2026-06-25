import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { AguiModule } from '../agui/agui.module';
import { QaOpsController } from './qa-ops.controller';
import { QaOpsService } from './qa-ops.service';

@Module({
  imports: [ChatModule, AguiModule],
  controllers: [QaOpsController],
  providers: [QaOpsService],
})
export class QaOpsModule {}
