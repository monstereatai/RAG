import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentMetaEntity } from '../../providers/db/entities/document-meta.entity';
import { DocumentPermissionEntity } from '../../providers/db/entities/document-permission.entity';
import { UserEntity } from '../../providers/db/entities/user.entity';
import { DocumentPermissionService } from './document-permission.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentMetaEntity,
      DocumentPermissionEntity,
      UserEntity,
    ]),
  ],
  providers: [DocumentPermissionService],
  exports: [DocumentPermissionService],
})
export class DocumentPermissionModule {}
