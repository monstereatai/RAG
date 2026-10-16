import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { TeamWikiPageEntity } from '../../providers/db/entities/team-wiki-page.entity';
import { TeamWikiRevisionEntity } from '../../providers/db/entities/team-wiki-revision.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DocumentModule } from '../document/document.module';
import { DocumentPermissionModule } from '../document/document-permission.module';
import { TeamWikiAdminController } from './team-wiki-admin.controller';
import { TeamWikiController } from './team-wiki.controller';
import { TeamWikiService } from './team-wiki.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TeamWikiPageEntity,
      TeamWikiRevisionEntity,
      DocumentMetaEntity,
      UserEntity,
    ]),
    DocumentModule,
    DocumentPermissionModule,
  ],
  controllers: [TeamWikiController, TeamWikiAdminController],
  providers: [TeamWikiService],
})
export class TeamWikiModule {}
