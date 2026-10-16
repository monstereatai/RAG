import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FeishuWikiConnectorEntity,
  FeishuWikiItemEntity,
} from '../../providers/db/entities/feishu-wiki-connector.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DocumentModule } from '../document/document.module';
import { DocumentPermissionModule } from '../document/document-permission.module';
import { FeishuWikiApiClient } from './feishu-wiki-api.client';
import { FeishuWikiAdminController } from './feishu-wiki-admin.controller';
import { FeishuWikiSyncController } from './feishu-wiki-sync.controller';
import { FeishuWikiSyncService } from './feishu-wiki-sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeishuWikiConnectorEntity,
      FeishuWikiItemEntity,
      UserEntity,
    ]),
    DocumentModule,
    DocumentPermissionModule,
  ],
  controllers: [FeishuWikiSyncController, FeishuWikiAdminController],
  providers: [FeishuWikiApiClient, FeishuWikiSyncService],
  exports: [FeishuWikiSyncService],
})
export class FeishuWikiSyncModule {}
