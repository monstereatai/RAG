import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { OfficialDocsSyncService } from './official-docs-sync.service';

@Module({
  imports: [DocumentModule],
  providers: [OfficialDocsSyncService],
  exports: [OfficialDocsSyncService],
})
export class OfficialDocsSyncModule {}
