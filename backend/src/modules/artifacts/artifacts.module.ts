import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactAccessLogEntity } from '../../providers/db/entities/artifact-access-log.entity';
import { ArtifactShareEntity } from '../../providers/db/entities/artifact-share.entity';
import { GeneratedArtifactEntity } from '../../providers/db/entities/generated-artifact.entity';
import { ArtifactGeneratorService } from './artifact-generator.service';
import { ArtifactQueueService } from './artifact-queue.service';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
import { DashScopeImageService } from './dashscope-image.service';
import { PublicArtifactsController } from './public-artifacts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeneratedArtifactEntity,
      ArtifactShareEntity,
      ArtifactAccessLogEntity,
    ]),
  ],
  controllers: [ArtifactsController, PublicArtifactsController],
  providers: [
    ArtifactsService,
    ArtifactGeneratorService,
    ArtifactQueueService,
    DashScopeImageService,
  ],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
