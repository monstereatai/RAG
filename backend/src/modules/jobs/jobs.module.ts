import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ScheduledJobEntity } from '../../providers/db/entities/job.entity';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorModule } from '../supervisor/supervisor.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([ScheduledJobEntity]),
    SupervisorModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, RolesGuard],
  exports: [JobsService],
})
export class JobsModule {}
